export interface RawCommenter {
  sec_uid?: string | null;
  nickname?: string;
  comment_text?: string;
}

export interface MappedComment {
  commenter_id: string;
  text: string;
}

export function mapRawCommenters(rawCommenters: RawCommenter[]): MappedComment[] {
  return rawCommenters.map((c) => ({
    commenter_id: c.sec_uid ? `/user/${c.sec_uid}` : c.nickname || '',
    text: c.comment_text || '',
  }));
}
