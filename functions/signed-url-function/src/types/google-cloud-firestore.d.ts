declare module '@google-cloud/firestore' {
  export class Firestore {
    constructor(options?: Record<string, unknown>)
    collection(name: string): {
      doc(documentPath: string): {
        set(data: unknown, options?: unknown): Promise<void>
      }
    }
  }

  export const FieldValue: {
    serverTimestamp(): unknown
  }
}
