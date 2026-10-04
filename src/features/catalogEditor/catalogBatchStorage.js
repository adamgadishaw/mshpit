const unavailable = () => { throw new Error("Durable catalog storage is unavailable on this platform."); };
export const catalogBatchStorage = { getItem: unavailable, setItem: unavailable };
