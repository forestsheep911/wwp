import type {
  MovieCreditEntry,
  PersonBiography,
  PersonExternalIds,
  PersonImage,
  PersonNameEntry,
  PersonSourceRef
} from "@wwpdw/shared";

export interface PersonEvidence {
  externalIds: PersonExternalIds;
  names: PersonNameEntry[];
  biography?: PersonBiography;
  images?: PersonImage[];
  sourceRefs: PersonSourceRef[];
  observedAt: string;
}

export interface WorkCreditEvidence {
  workExternalId: string;
  workKind: "movie" | "series";
  credits: MovieCreditEntry[];
  observedAt: string;
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
