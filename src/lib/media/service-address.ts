// A separate origin alone does not isolate backups: every service caller must use this address.
export const VERIFICATION = import.meta.env.MODE === 'verification';
export const SERVICE = VERIFICATION ? 'http://127.0.0.1:18765' : 'http://127.0.0.1:8765';
