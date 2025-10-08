
import { Question, QuestionType, Result, QuizRoom, Player, Answer } from '../types';

// --- Question Parsers ---

export const parseJsonQuestions = (jsonString: string): Question[] => {
  const data = JSON.parse(jsonString);
  if (!Array.isArray(data)) {
    throw new Error('JSON must be an array of questions.');
  }
  return data.map(validateQuestion);
};

export const parseCsvQuestions = (csvString: string): Question[] => {
  const lines = csvString.trim().split('\n');
  const headers = lines.shift()?.trim().split(',');
  if (!headers || !['id', 'text', 'type'].every(h => headers.includes(h))) {
    throw new Error('CSV must contain id, text, and type columns.');
  }

  return lines.map(line => {
    const values = line.split(',');
    const questionData: any = headers.reduce((obj, header, index) => {
      obj[header.trim()] = values[index]?.trim() || '';
      return obj;
    }, {} as any);

    const question: Partial<Question> = {
      id: questionData.id,
      text: questionData.text,
      type: questionData.type,
      points: questionData.points ? parseInt(questionData.points, 10) : 10,
      imageUrl: questionData.imageUrl || null,
    };
    
    if (question.type === QuestionType.SINGLE) {
      question.options = questionData.options?.split('|') || [];
      question.correct = questionData.correct ? [parseInt(questionData.correct, 10)] : [];
    } else if (question.type === QuestionType.OPEN) {
      question.correct = questionData.correct ? questionData.correct.split('|') : [];
    }

    return validateQuestion(question);
  });
};

const validateQuestion = (q: any): Question => {
  if (!q.id || !q.text || !q.type) {
    throw new Error('Each question must have an id, text, and type.');
  }
  if (!Object.values(QuestionType).includes(q.type)) {
    throw new Error(`Invalid question type: ${q.type}`);
  }
  if (q.type === QuestionType.SINGLE && (!Array.isArray(q.options) || q.options.length < 2 || !q.correct || q.correct.length !==1 )) {
    throw new Error(`Single choice question '${q.id}' is malformed. It needs at least 2 options and exactly one correct index.`);
  }
  return {
    id: q.id,
    text: q.text,
    type: q.type,
    options: q.options,
    correct: q.correct || [],
    points: q.points ?? 10,
    imageUrl: q.imageUrl,
  };
};

// --- Result Calculation ---

export const calculateResults = (room: QuizRoom): Result[] => {
    const playerScores: Record<string, number> = {};
    Object.values(room.players).forEach(p => playerScores[p.uid] = 0);

    room.answers.forEach(answer => {
        const question = room.questions.find(q => q.id === answer.questionId);
        if (!question) return;

        let isCorrect = false;
        if (question.type === QuestionType.SINGLE) {
            isCorrect = question.correct[0] === answer.value;
        } else if (question.type === QuestionType.OPEN) {
            isCorrect = question.correct.length > 0 && question.correct
                .map(c => String(c).trim().toLowerCase())
                .includes(String(answer.value).trim().toLowerCase());
        }

        if (isCorrect) {
            playerScores[answer.uid] = (playerScores[answer.uid] || 0) + question.points;
        }
    });

    const sortedResults = Object.entries(playerScores)
        .map(([uid, totalPoints]) => ({
            uid,
            displayName: room.players[uid]?.displayName || 'Unknown Player',
            totalPoints,
        }))
        .sort((a, b) => b.totalPoints - a.totalPoints);
    
    return sortedResults.map((result, index) => ({
        ...result,
        rank: index + 1,
    }));
};

// --- CSV Exporters ---

const downloadFile = (filename: string, content: string) => {
    const element = document.createElement('a');
    const file = new Blob([content], { type: 'text/csv' });
    element.href = URL.createObjectURL(file);
    element.download = filename;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
};

export const exportSummaryCSV = (results: Result[]) => {
    const headers = ['rank', 'playerUid', 'playerName', 'totalPoints'];
    const rows = results.map(r => [r.rank, r.uid, `"${r.displayName}"`, r.totalPoints].join(','));
    const csvContent = [headers.join(','), ...rows].join('\n');
    downloadFile(`quiz-summary-${Date.now()}.csv`, csvContent);
};


export const exportDetailedCSV = (room: QuizRoom) => {
    const headers = ['playerUid', 'playerName', 'questionId', 'questionText', 'playerAnswer', 'isCorrect', 'earnedPoints'];
    const playerMap: Record<string, Player> = room.players;
    const questionMap: Record<string, Question> = room.questions.reduce((acc, q) => ({...acc, [q.id]: q}), {});

    const rows = room.answers.map(answer => {
        const player = playerMap[answer.uid];
        const question = questionMap[answer.questionId];
        if (!player || !question) return '';
        
        let isCorrect = false;
        let points = 0;
        let answerText = String(answer.value);

        if (question.type === QuestionType.SINGLE) {
            isCorrect = question.correct[0] === answer.value;
            answerText = question.options?.[answer.value as number] ?? 'Invalid Answer';
        } else { // OPEN
            isCorrect = question.correct.length > 0 && question.correct
                .map(c => String(c).toLowerCase().trim())
                .includes(String(answer.value).toLowerCase().trim());
        }

        if (isCorrect) {
            points = question.points;
        }
        
        return [
            player.uid,
            `"${player.displayName}"`,
            question.id,
            `"${question.text}"`,
            `"${answerText}"`,
            isCorrect,
            points
        ].join(',');
    }).filter(Boolean);

    const csvContent = [headers.join(','), ...rows].join('\n');
    downloadFile(`quiz-detailed-${Date.now()}.csv`, csvContent);
};
