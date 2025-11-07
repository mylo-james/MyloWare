/**
 * Strip embedding vectors from memory objects to reduce payload size
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function stripEmbeddings(obj: any): any {
  const strip = (item: Record<string, unknown>): Omit<Record<string, unknown>, 'embedding'> => {
    if (!item || typeof item !== 'object') return item;
    const { embedding, ...rest } = item;
    void embedding;
    return rest;
  };
  
  if (Array.isArray(obj)) {
    return obj.map((item) => strip(item as Record<string, unknown>));
  }
  
  if (obj && typeof obj === 'object') {
    return strip(obj as Record<string, unknown>);
  }
  
  return obj;
}

// Alias for backward compatibility
export const formatForAPI = stripEmbeddings;
