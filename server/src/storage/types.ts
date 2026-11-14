export type VoteChoice = 'like' | 'dislike';

export interface ArticleStats {
  views: number;
  likes: number;
  dislikes: number;
}

export interface VoteRecord {
  slug: string;
  voterHash: string;
  choice: VoteChoice;
}
