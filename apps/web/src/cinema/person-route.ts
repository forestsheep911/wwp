import type { MovieCreditDepartment, PublicPersonWork } from "@wwpdw/shared";

const labels: Partial<Record<MovieCreditDepartment, string>> = {
  directing: "导演",
  writing: "编剧",
  acting: "演员",
  production: "制片",
  camera: "摄影",
  editing: "剪辑",
  music: "音乐",
  art: "美术",
  costume: "造型",
  visual_effects: "视觉特效",
  crew: "主创",
  other: "其他"
};

export function personDepartmentLabel(department: MovieCreditDepartment) {
  return labels[department] ?? department;
}

export interface PersonFilmographyWork {
  workId: string;
  title?: string;
  credits: PublicPersonWork[];
  roleLabels: string[];
}

export function groupPersonWorksByWork(works: PublicPersonWork[]): PersonFilmographyWork[] {
  const grouped = new Map<string, PublicPersonWork[]>();
  for (const work of works) {
    grouped.set(work.workId, [...(grouped.get(work.workId) ?? []), work]);
  }

  return [...grouped.entries()].map(([workId, credits]) => ({
    workId,
    title: credits.find((credit) => credit.title)?.title,
    credits,
    roleLabels: [...new Set(credits.map((credit) => (
      credit.character
        ? `${personDepartmentLabel(credit.department)} · ${credit.character}`
        : personDepartmentLabel(credit.department)
    )))]
  }));
}
