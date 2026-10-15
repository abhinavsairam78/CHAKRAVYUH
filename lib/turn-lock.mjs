// Reject overlapping writes rather than silently reordering a conversation.
export const busyCalls = new Set();
export async function withCallLock(id, operation) {
  if (busyCalls.has(id)) throw Object.assign(new Error('A reply is still being prepared. Please wait.'), { status: 409 });
  busyCalls.add(id);
  try { return await operation(); } finally { busyCalls.delete(id); }
}
