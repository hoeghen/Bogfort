/**
 * Storage layout for bilag. Drafts upload under `drafts/`, which the client may
 * write; on posting, the function copies the file to its permanent path
 * (spec §5: /bilag/{vrid}/{aar}/{post-id}) where no client can write.
 */
export function draftAttachmentPath(companyId: string, draftId: string, fileName: string): string {
  return `bilag/${companyId}/drafts/${draftId}/${sanitizeFileName(fileName)}`;
}

export function postedAttachmentPath(companyId: string, year: string, postId: string, fileName: string): string {
  return `bilag/${companyId}/${year}/${postId}${extensionOf(fileName)}`;
}

export function extensionOf(fileName: string): string {
  const m = /\.([a-z0-9]{1,5})$/i.exec(fileName);
  return m ? `.${m[1]!.toLowerCase()}` : '';
}

export function sanitizeFileName(name: string): string {
  const cleaned = name.normalize('NFKD').replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_');
  return cleaned.slice(-120) || 'bilag';
}

export const ALLOWED_ATTACHMENT_TYPES = ['application/pdf', 'image/png', 'image/jpeg'] as const;
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
