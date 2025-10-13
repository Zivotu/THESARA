export interface ThesaraStorage {
  getItem(roomId: string, key: string): Promise<string | null>;
  setItem(roomId: string, key: string, value: string): Promise<void>;
  removeItem(roomId: string, key: string): Promise<void>;
}

export function initializeThesara(): Promise<ThesaraStorage>;
