
export enum QuestionType {
  SINGLE = 'single',
  OPEN = 'open',
}

export interface Question {
  id: string;
  text: string;
  type: QuestionType;
  options?: string[];
  correct: (number | string)[];
  points: number;
  imageUrl?: string | null;
}

export enum RoomStatus {
  LOBBY = 'lobby',
  LIVE = 'live',
  ENDED = 'ended',
}

export interface Player {
  uid: string;
  displayName: string;
  joinedAt: number;
}

export interface Answer {
  questionId: string;
  uid: string;
  value: string | number;
  submittedAt: number;
}

export interface QuizRoom {
  pin: string;
  adminUid: string;
  status: RoomStatus;
  createdAt: number;
  currentIndex: number;
  questions: Question[];
  players: Record<string, Player>;
  answers: Answer[];
}

export interface User {
  uid: string;
  displayName: string;
}

export interface Result {
  rank: number;
  uid: string;
  displayName: string;
  totalPoints: number;
}
