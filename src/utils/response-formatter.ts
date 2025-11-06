/**
 * Strip embedding vectors from memory objects to reduce payload size
 */
export function stripEmbeddings(obj: any): any {
  const strip = (item: any): any => {
    if (!item || typeof item !== 'object') return item;
    const { embedding, ...rest } = item;
    return rest;
  };
  
  return Array.isArray(obj) ? obj.map(strip) : strip(obj);
}

// Alias for backward compatibility
export const formatForAPI = stripEmbeddings;

