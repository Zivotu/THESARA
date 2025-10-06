declare global {
  interface Window {
    loopyway?: {
      kv: {
        get: (appId: string, key: string) => Promise<any>;
        set: (appId: string, key: string, value: any) => Promise<boolean>;
      };
      net: {
        fetch: (
          appId: string,
          url: string,
          options?: {
            method?: string;
            headers?: Record<string, string>;
            body?: any;
          }
        ) => Promise<any>;
      };
      camera: { request: (constraints?: MediaStreamConstraints) => Promise<MediaStream> };
      mic: { request: (constraints?: MediaStreamConstraints) => Promise<MediaStream> };
      score: {
        /** Submit a score for the current player. Stores locally if not authenticated. */
        submit: (appId: string, score: number) => Promise<any>;
        /** Fetch leaderboard entries. */
        leaderboard: (appId: string, limit?: number) => Promise<any[]>;
        /** Flush any locally stored pending score once the user logs in. */
        flushPending: (appId: string) => void;
      };
      rooms: {
        createRoom: (appId: string) => Promise<string>;
        joinRoom: (roomId: string, data?: any) => Promise<{ playerId: string }>;
        onPlayers: (roomId: string, cb: (players: any[]) => void) => () => void;
        updatePlayer: (
          roomId: string,
          playerId: string,
          data: any,
        ) => Promise<void>;
        sendEvent: (
          roomId: string,
          type: string,
          payload: any,
        ) => Promise<void>;
        onEvent: (roomId: string, cb: (event: any) => void) => () => void;
      };
    };
  }
}
export {};
