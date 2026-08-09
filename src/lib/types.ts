// Catalyst — Shared TypeScript types (mirrors DB schema)

export interface User {
  id: string;
  email: string;
  name: string | null;
  password_hash: string;
  created_at: string;
}

export interface Subject {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  created_at: string;
  archived: boolean;
}

export interface NoteFile {
  id: string;
  subject_id: string;
  filename: string;
  content_hash: string;
  source: 'upload' | 'paste' | 'watcher';
  created_at: string;
  updated_at: string;
}

export interface NoteVersion {
  id: string;
  note_file_id: string;
  content: string;
  created_at: string;
}

export interface GraphNode {
  id: string;
  subject_id: string;
  name: string;
  definition: string;
  reference_count: number;
  manually_edited: boolean;
  created_at: string;
  updated_at: string;
}

export interface GraphEdge {
  id: string;
  subject_id: string;
  from_node_id: string;
  to_node_id: string;
  relationship_type: string; // "depends on" | "is a type of" | "contrasts with" | "part of" | etc.
  created_at: string;
}

export type CardType = 'qa' | 'cloze';
export type CardStatus = 'new' | 'accepted' | 'edited' | 'deleted';

export interface Flashcard {
  id: string;
  subject_id: string;
  note_file_id: string;
  node_ids: string; // JSON stringified array
  front: string;
  back: string;
  card_type: CardType;
  status: CardStatus;
  created_at: string;
  updated_at: string;
  // SM-2 scheduling fields
  next_review_at: string | null;
  interval: number; // days
  ease_factor: number; // 2.5 default
  review_count: number;
}

export interface ReviewHistory {
  id: string;
  card_id: string;
  user_id: string;
  rating: 'again' | 'hard' | 'good' | 'easy';
  reviewed_at: string;
  next_review_at: string;
  interval: number;
  ease_factor: number;
}

// API response shapes

export interface SubjectStats {
  note_count: number;
  graph_node_count: number;
  graph_edge_count: number;
  card_count: number;
  cards_due_today: number;
  last_synced_at: string | null;
}

export interface SubjectWithStats extends Subject {
  stats: SubjectStats;
}

export interface GraphData {
  nodes: (GraphNode & { node_ids?: string[] })[];
  edges: (GraphEdge & {
    from_name?: string;
    to_name?: string;
  })[];
}

export interface PipelineResult {
  nodes_created: number;
  nodes_merged: number;
  edges_created: number;
  cards_created: number;
  cards_deduplicated: number;
  processing_time_ms: number;
}

export interface ProcessNoteRequest {
  subject_id: string;
  filename: string;
  content: string;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
}