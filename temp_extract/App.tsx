
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { initializeThesara, ThesaraStorage } from '@thesara/client';
import { Question, RoomStatus, User, QuizRoom, Player, QuestionType, Answer, Result } from './types';
import { parseJsonQuestions, parseCsvQuestions, calculateResults, exportSummaryCSV, exportDetailedCSV } from './services/quizUtils';
import Button from './components/Button';
import Modal from './components/Modal';
import Spinner from './components/Spinner';
import { UploadIcon, CheckCircleIcon, UsersIcon, CrownIcon } from './components/Icons';

// --- MOCK DATA & HELPERS ---
const MOCK_USERS: User[] = [
    { uid: 'admin1', displayName: 'QuizMaster' },
    { uid: 'player1', displayName: 'Ada Lovelace' },
    { uid: 'player2', displayName: 'Grace Hopper' },
    { uid: 'player3', displayName: 'Alan Turing' }
];

const generatePin = () => Math.floor(100000 + Math.random() * 900000).toString();

// Main App Component
const App: React.FC = () => {
    const [storage, setStorage] = useState<ThesaraStorage | null>(null);
    const [storageError, setStorageError] = useState<string | null>(null);
    const [currentUser, setCurrentUser] = useState<User>(MOCK_USERS[0]);
    const [room, setRoom] = useState<QuizRoom | null>(null);
    const [error, setError] = useState<string>('');
    const [loading, setLoading] = useState<boolean>(false);

    useEffect(() => {
        initializeThesara()
            .then(setStorage)
            .catch(err => {
                console.error(err);
                setStorageError('Thesara storage nije dostupan. Ova aplikacija zahtijeva thesara.storage. Provjeri da je dostupan u globalnom objektu.');
            });
    }, []);

    // --- MOCK BACKEND LOGIC ---
    // In a real app, this would be handled by Firestore listeners and functions.
    // For this example, we manage state locally.

    const handleCreateRoom = useCallback(async (questions: Question[]) => {
        if (!storage) return;
        setLoading(true);
        setError('');
        try {
            const pin = generatePin();
            const newRoom: QuizRoom = {
                pin,
                adminUid: currentUser.uid,
                status: RoomStatus.LOBBY,
                createdAt: Date.now(),
                currentIndex: -1,
                questions,
                players: {},
                answers: [],
            };
            await storage.setItem(pin, 'room', JSON.stringify(newRoom));
            setRoom(newRoom);
        } catch (e) {
            setError('Failed to create room.');
        } finally {
            setLoading(false);
        }
    }, [currentUser, storage]);

    const handleJoinRoom = useCallback(async (pin: string) => {
        if (!storage) return;
        setLoading(true);
        setError('');
        try {
            const storedRoom = await storage.getItem(pin, 'room');
            if (!storedRoom) {
                setError('Room not found.');
                return;
            }

            let parsedRoom: QuizRoom | null = null;
            try {
                parsedRoom = JSON.parse(storedRoom) as QuizRoom;
            } catch (parseError) {
                console.error('Failed to parse stored room.', parseError);
                setError('Stored room data is invalid.');
                return;
            }

            if (Object.keys(parsedRoom.players).length >= 100) {
                setError('Room is full.');
                return;
            }

            const newPlayer: Player = { uid: currentUser.uid, displayName: currentUser.displayName, joinedAt: Date.now() };
            const updatedRoom: QuizRoom = {
                ...parsedRoom,
                players: { ...parsedRoom.players, [currentUser.uid]: newPlayer },
            };

            await storage.setItem(pin, 'room', JSON.stringify(updatedRoom));
            setRoom(updatedRoom);
        } catch (e) {
            console.error(e);
            setError('Failed to join room.');
        } finally {
            setLoading(false);
        }
    }, [currentUser, storage]);
    
    const handleStartGame = useCallback(() => {
        setRoom(prev => prev ? { ...prev, status: RoomStatus.LIVE, currentIndex: 0 } : null);
    }, []);

    const handleChangeQuestion = useCallback((direction: 'next' | 'back') => {
        setRoom(prev => {
            if (!prev) return null;
            const newIndex = direction === 'next' ? prev.currentIndex + 1 : prev.currentIndex - 1;
            if (newIndex >= 0 && newIndex < prev.questions.length) {
                return { ...prev, currentIndex: newIndex };
            }
            return prev;
        });
    }, []);
    
    const handleEndGame = useCallback(() => {
        if(window.confirm("Are you sure you want to end the game? This cannot be undone.")) {
            setRoom(prev => prev ? { ...prev, status: RoomStatus.ENDED } : null);
        }
    }, []);

    const handleSubmitAnswer = useCallback((value: string | number) => {
        setRoom(prev => {
            if (!prev || prev.currentIndex < 0) return null;
            const questionId = prev.questions[prev.currentIndex].id;
            const newAnswer: Answer = {
                questionId,
                uid: currentUser.uid,
                value,
                submittedAt: Date.now(),
            };
            // Prevent duplicate answers
            const existingAnswerIndex = prev.answers.findIndex(a => a.questionId === questionId && a.uid === currentUser.uid);
            const newAnswers = [...prev.answers];
            if(existingAnswerIndex > -1) {
                newAnswers[existingAnswerIndex] = newAnswer;
            } else {
                newAnswers.push(newAnswer);
            }

            return { ...prev, answers: newAnswers };
        });
    }, [currentUser.uid]);
    
    const handleLeaveRoom = () => {
        setRoom(null);
        setError('');
    };

    // --- DERIVED STATE ---
    const isCurrentUserAdmin = room?.adminUid === currentUser.uid;
    const currentQuestion = room && room.currentIndex >= 0 ? room.questions[room.currentIndex] : null;
    const currentUserAnswer = room && currentQuestion ? room.answers.find(a => a.uid === currentUser.uid && a.questionId === currentQuestion.id) : null;
    const results = useMemo(() => room && room.status === RoomStatus.ENDED ? calculateResults(room) : [], [room]);

    // --- RENDER LOGIC ---
    const renderContent = () => {
        if (storageError) {
            return <div className="flex items-center justify-center h-screen text-red-400">{storageError}</div>;
        }

        if (!storage) {
            return <div className="flex items-center justify-center h-screen"><Spinner /></div>;
        }

        if (loading) {
            return <div className="flex items-center justify-center h-screen"><Spinner /></div>;
        }

        if (!room) {
            return <HomeScreen onCreate={handleCreateRoom} onJoin={handleJoinRoom} error={error} currentUser={currentUser} />;
        }

        if (room.status === RoomStatus.LOBBY) {
            return <LobbyScreen room={room} isAdmin={isCurrentUserAdmin} onStart={handleStartGame} onLeave={handleLeaveRoom} />;
        }

        if (room.status === RoomStatus.LIVE) {
            return <GameScreen 
                room={room} 
                isAdmin={isCurrentUserAdmin} 
                question={currentQuestion}
                onNext={() => handleChangeQuestion('next')}
                onBack={() => handleChangeQuestion('back')}
                onEnd={handleEndGame}
                onSubmitAnswer={handleSubmitAnswer}
                currentUserAnswerValue={currentUserAnswer?.value}
            />;
        }

        if (room.status === RoomStatus.ENDED) {
            return <EndScreen room={room} isAdmin={isCurrentUserAdmin} results={results} onLeave={handleLeaveRoom} />;
        }
        
        return null;
    };

    return (
        <div className="min-h-screen bg-gray-900 text-white font-sans p-4 sm:p-6 lg:p-8">
            <header className="flex justify-between items-center mb-8">
                <h1 className="text-4xl font-bold text-indigo-400">Pub Quiz</h1>
                <div className="flex items-center space-x-2">
                    <span className="text-gray-400">Signed in as:</span>
                    <select value={currentUser.uid} onChange={(e) => setCurrentUser(MOCK_USERS.find(u => u.uid === e.target.value)!)} className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-500">
                        {MOCK_USERS.map(user => <option key={user.uid} value={user.uid}>{user.displayName}</option>)}
                    </select>
                </div>
            </header>
            <main>
                {renderContent()}
            </main>
        </div>
    );
};

// --- SCREEN COMPONENTS ---

const HomeScreen: React.FC<{onCreate: (q: Question[]) => void; onJoin: (pin: string) => void; error: string; currentUser: User;}> = ({onCreate, onJoin, error, currentUser}) => {
    const [pin, setPin] = useState('');
    const [questions, setQuestions] = useState<Question[] | null>(null);
    const [fileName, setFileName] = useState('');
    const [fileError, setFileError] = useState('');
    const [isHelpModalOpen, setHelpModalOpen] = useState(false);

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setFileName(file.name);
        setFileError('');
        try {
            const text = await file.text();
            const parsedQuestions = file.type === 'application/json' ? parseJsonQuestions(text) : parseCsvQuestions(text);
            if (parsedQuestions.length === 0) throw new Error("No questions found in file.");
            setQuestions(parsedQuestions);
        } catch (err: any) {
            setFileError(err.message || 'Failed to parse file.');
            setQuestions(null);
            setFileName('');
        }
    };
    
    return (
        <div className="max-w-4xl mx-auto grid md:grid-cols-2 gap-8">
            {/* Create Room */}
            <div className="bg-gray-800 p-8 rounded-xl shadow-lg flex flex-col space-y-6">
                <h2 className="text-3xl font-bold text-center">Create a Room</h2>
                <p className="text-center text-gray-400">Upload your questions to start a new quiz.</p>

                <label htmlFor="file-upload" className="cursor-pointer bg-gray-700 border-2 border-dashed border-gray-600 rounded-lg p-6 text-center hover:border-indigo-500 hover:bg-gray-600 transition">
                    <UploadIcon className="w-12 h-12 mx-auto text-gray-400" />
                    <span className="mt-2 block font-semibold">{fileName || "Upload JSON or CSV file"}</span>
                    <input id="file-upload" type="file" accept=".json,.csv" className="hidden" onChange={handleFileChange} />
                </label>
                <button onClick={() => setHelpModalOpen(true)} className="text-indigo-400 hover:underline text-sm">How to format questions?</button>
                
                {fileError && <p className="text-red-400 text-center">{fileError}</p>}
                
                <Button onClick={() => questions && onCreate(questions)} disabled={!questions}>
                    Create Room
                </Button>
            </div>

            {/* Join Room */}
            <div className="bg-gray-800 p-8 rounded-xl shadow-lg flex flex-col space-y-6">
                 <h2 className="text-3xl font-bold text-center">Join a Room</h2>
                <p className="text-center text-gray-400">Enter the 6-digit PIN to join an existing quiz.</p>
                
                <input 
                    type="text" 
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="6-digit PIN"
                    maxLength={6}
                    className="w-full bg-gray-900 border border-gray-700 text-white rounded-lg p-4 text-center text-2xl tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <Button onClick={() => onJoin(pin)} variant="secondary" disabled={pin.length !== 6}>
                    Join as {currentUser.displayName}
                </Button>
            </div>
            {error && <p className="text-red-400 text-center md:col-span-2 mt-4">{error}</p>}
            <FormatHelpModal isOpen={isHelpModalOpen} onClose={() => setHelpModalOpen(false)} />
        </div>
    );
};

const LobbyScreen: React.FC<{room: QuizRoom; isAdmin: boolean; onStart: () => void; onLeave: () => void;}> = ({ room, isAdmin, onStart, onLeave }) => {
    return (
        <div className="max-w-4xl mx-auto bg-gray-800 p-8 rounded-xl shadow-lg">
            <div className="flex justify-between items-start">
                <div>
                    <h2 className="text-3xl font-bold">Quiz Lobby</h2>
                    <p className="text-gray-400">Waiting for the game to start...</p>
                </div>
                 <div className="text-right">
                    <p className="text-gray-400">ROOM PIN</p>
                    <p className="text-4xl font-bold tracking-widest text-indigo-400">{room.pin}</p>
                </div>
            </div>

            <div className="mt-8">
                <h3 className="text-xl font-semibold mb-4 flex items-center"><UsersIcon className="w-6 h-6 mr-2" /> Players ({Object.keys(room.players).length})</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 max-h-60 overflow-y-auto p-2 bg-gray-900 rounded-lg">
                    {/* FIX: Use Object.entries for robust type inference when iterating over players. */}
                    {Object.entries(room.players).map(([uid, player]) => (
                        <div key={uid} className="bg-gray-700 p-3 rounded-md text-center truncate">
                            {player.displayName}
                        </div>
                    ))}
                    {Object.keys(room.players).length === 0 && <p className="col-span-full text-center text-gray-500 py-4">No players have joined yet.</p>}
                </div>
            </div>

            {isAdmin && (
                <div className="mt-8">
                    <h3 className="text-xl font-semibold mb-2">Questions ({room.questions.length})</h3>
                    <p className="text-gray-400 mb-4">You have successfully loaded {room.questions.length} questions.</p>
                </div>
            )}
            
            <div className="mt-12 flex flex-col sm:flex-row justify-between items-center space-y-4 sm:space-y-0">
                <Button onClick={onLeave} variant="ghost">Leave Room</Button>
                {isAdmin && <Button onClick={onStart} disabled={room.questions.length === 0}>Start Game</Button>}
            </div>
        </div>
    );
};

const GameScreen: React.FC<{
    room: QuizRoom;
    isAdmin: boolean;
    question: Question | null;
    onNext: () => void;
    onBack: () => void;
    onEnd: () => void;
    onSubmitAnswer: (value: string | number) => void;
    currentUserAnswerValue?: string | number;
}> = ({ room, isAdmin, question, onNext, onBack, onEnd, onSubmitAnswer, currentUserAnswerValue }) => {
    const [openAnswer, setOpenAnswer] = useState('');

    const hasAnswered = currentUserAnswerValue !== undefined;

    const handleSubmitOpen = (e: React.FormEvent) => {
        e.preventDefault();
        onSubmitAnswer(openAnswer);
    };

    if (!question) {
        return (
            <div className="text-center p-8">
                <h2 className="text-2xl">Loading question...</h2>
                <Spinner />
            </div>
        );
    }

    if (isAdmin) {
        return (
            <div className="max-w-4xl mx-auto">
                <div className="bg-gray-800 p-8 rounded-xl shadow-lg mb-6">
                    <p className="text-indigo-400 font-semibold">Question {room.currentIndex + 1} / {room.questions.length}</p>
                    <h2 className="text-3xl font-bold mt-2">{question.text}</h2>
                    {question.imageUrl && <img src={question.imageUrl} alt="Question visual" className="mt-4 rounded-lg max-h-80 mx-auto" />}
                </div>
                 <div className="flex justify-between items-center">
                    <Button onClick={onBack} variant="secondary" disabled={room.currentIndex <= 0}>Back</Button>
                    <Button onClick={onEnd} variant="danger">End Game</Button>
                    <Button onClick={onNext} variant="primary" disabled={room.currentIndex >= room.questions.length - 1}>Next</Button>
                </div>
            </div>
        );
    }
    
    return (
         <div className="max-w-3xl mx-auto bg-gray-800 p-8 rounded-xl shadow-lg">
            <p className="text-indigo-400 font-semibold">Question {room.currentIndex + 1} / {room.questions.length}</p>
            <h2 className="text-3xl font-bold mt-2">{question.text}</h2>
             {question.imageUrl && <img src={question.imageUrl} alt="Question visual" className="mt-4 rounded-lg max-h-80 mx-auto" />}
            
            <div className="mt-8">
            {hasAnswered ? (
                 <div className="text-center py-10 bg-gray-700 rounded-lg">
                    <CheckCircleIcon className="w-16 h-16 text-green-400 mx-auto" />
                    <p className="mt-4 text-2xl font-semibold">Answer Saved</p>
                    <p className="text-gray-400">Waiting for the next question.</p>
                </div>
            ) : (
                <>
                {question.type === QuestionType.SINGLE && question.options && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {question.options.map((option, index) => (
                            <button key={index} onClick={() => onSubmitAnswer(index)} className="w-full text-left p-4 bg-gray-700 rounded-lg hover:bg-indigo-600 transition text-lg">
                                <span className="font-bold mr-2">{String.fromCharCode(65 + index)}.</span> {option}
                            </button>
                        ))}
                    </div>
                )}
                {question.type === QuestionType.OPEN && (
                    <form onSubmit={handleSubmitOpen} className="flex flex-col sm:flex-row gap-4">
                        <input
                            type="text"
                            value={openAnswer}
                            onChange={(e) => setOpenAnswer(e.target.value)}
                            className="flex-grow bg-gray-900 border border-gray-700 rounded-lg p-4 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-lg"
                            placeholder="Type your answer..."
                        />
                        <Button type="submit">Submit</Button>
                    </form>
                )}
                </>
            )}
            </div>
         </div>
    );
};

const EndScreen: React.FC<{room: QuizRoom; isAdmin: boolean; results: Result[]; onLeave: () => void;}> = ({ room, isAdmin, results, onLeave }) => {
    return (
        <div className="max-w-4xl mx-auto bg-gray-800 p-8 rounded-xl shadow-lg text-center">
            <h2 className="text-4xl font-bold text-indigo-400">Game Over!</h2>
            <p className="text-xl text-gray-300 mt-2 mb-8">Here are the final results.</p>
            
            <div className="space-y-3 max-h-96 overflow-y-auto">
                {results.map((result, index) => (
                    <div key={result.uid} className={`flex items-center p-4 rounded-lg ${index < 3 ? 'bg-gray-700' : 'bg-gray-900/50'}`}>
                         <span className={`text-2xl font-bold w-12 ${index === 0 ? 'text-yellow-400' : index === 1 ? 'text-gray-300' : index === 2 ? 'text-yellow-600' : 'text-gray-500'}`}>
                            {result.rank}
                            {index === 0 && <CrownIcon className="w-6 h-6 inline-block ml-1"/>}
                         </span>
                         <span className="flex-grow text-left text-lg">{result.displayName}</span>
                         <span className="text-2xl font-bold text-indigo-400">{result.totalPoints} pts</span>
                    </div>
                ))}
            </div>

            <div className="mt-10 flex flex-col sm:flex-row justify-center items-center gap-4">
                <Button onClick={onLeave} variant="ghost">Back to Home</Button>
                {isAdmin && (
                    <>
                    <Button onClick={() => exportSummaryCSV(results)} variant="secondary">Download Summary CSV</Button>
                    <Button onClick={() => exportDetailedCSV(room)} variant="secondary">Download Detailed CSV</Button>
                    </>
                )}
            </div>
        </div>
    );
};


const FormatHelpModal: React.FC<{isOpen: boolean; onClose: () => void}> = ({isOpen, onClose}) => (
    <Modal isOpen={isOpen} onClose={onClose} title="How to format questions">
        <div className="space-y-6">
            <div>
                <h3 className="text-xl font-bold text-indigo-400 mb-2">JSON (recommended)</h3>
                <p className="text-gray-400 mb-2">Create a JSON file with an array of question objects.</p>
                <pre className="bg-gray-900 p-4 rounded-lg text-sm overflow-x-auto">
                    <code>{`[
  {
    "id": "q1",
    "text": "What is the capital of Croatia?",
    "type": "single",
    "options": ["Zagreb", "Split", "Rijeka", "Osijek"],
    "correct": [0],
    "points": 10
  },
  {
    "id": "q2",
    "text": "Type the chemical symbol for water",
    "type": "open",
    "correct": ["H2O", "h2o"],
    "points": 10
  }
]`}</code>
                </pre>
            </div>
            <div>
                <h3 className="text-xl font-bold text-indigo-400 mb-2">CSV</h3>
                 <p className="text-gray-400 mb-2">Create a CSV file with the following headers. Use '|' to separate multiple options or correct answers.</p>
                <pre className="bg-gray-900 p-4 rounded-lg text-sm overflow-x-auto">
                    <code>{`id,text,type,options,correct,points,imageUrl
q1,What is the capital of Croatia?,single,Zagreb|Split|Rijeka|Osijek,0,10,
q2,Type the chemical symbol for water,open,,H2O|h2o,10,`}</code>
                </pre>
            </div>
        </div>
    </Modal>
);

export default App;