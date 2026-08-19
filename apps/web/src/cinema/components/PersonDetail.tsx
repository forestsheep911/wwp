import { ArrowLeft, ExternalLink, Film, Loader2, UserRound } from "lucide-react";
import { selectPersonBiographyTexts, type PublicPersonDetail, type SearchResult } from "@wwpdw/shared";

import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { groupPersonWorksByWork, personDepartmentLabel } from "../person-route";
import { formatPersonDate, getPersonExternalLinks } from "../person-meta";
import { PosterImage } from "./PosterImage";

export function PersonDetail({
  person,
  works,
  loading,
  error,
  backLabel = "返回片库",
  onBack,
  onOpenWork,
  onRetry
}: {
  person?: PublicPersonDetail;
  works: SearchResult[];
  loading: boolean;
  error: string;
  backLabel?: string;
  onBack: () => void;
  onOpenWork: (work: SearchResult) => void;
  onRetry: () => void;
}) {
  if (loading) {
    return <div className="grid min-h-72 place-items-center rounded-xl border border-slate-800 bg-slate-950/70"><Loader2 className="h-7 w-7 animate-spin text-emerald-300" aria-label="正在加载人物资料" /></div>;
  }
  if (error || !person) {
    return (
      <section className="grid min-h-72 place-items-center gap-4 rounded-xl border border-rose-400/30 bg-slate-950/70 p-6 text-center">
        <div><p className="font-semibold text-slate-100">人物资料暂时无法打开</p><p className="mt-2 text-sm text-slate-400">{error || "没有找到这个人物。"}</p></div>
        <div className="flex gap-2"><Button variant="ghost" onClick={onBack}><ArrowLeft className="h-4 w-4" />{backLabel}</Button><Button onClick={onRetry}>重试</Button></div>
      </section>
    );
  }

  const resultByWorkId = new Map(works.map((work) => [work.metadata?.work?.workId ?? work.metadata?.workId, work]));
  const filmography = groupPersonWorksByWork(person.works);
  const biography = selectPersonBiographyTexts(person.biography);
  const birthDate = formatPersonDate(person.biography?.birthDate);
  const deathDate = formatPersonDate(person.biography?.deathDate);
  const originalName = person.names.original && ![person.names.primary, person.names.english].includes(person.names.original)
    ? person.names.original
    : undefined;
  const externalLinks = getPersonExternalLinks(person.externalIds);
  const facts = [
    birthDate ? { label: "出生", value: birthDate } : undefined,
    deathDate ? { label: "逝世", value: deathDate } : undefined,
    person.biography?.birthPlace ? { label: "出生地", value: person.biography.birthPlace } : undefined,
    originalName ? { label: "原名", value: originalName } : undefined
  ].filter((fact): fact is { label: string; value: string } => Boolean(fact));
  return (
    <section className="grid gap-6 rounded-xl border border-slate-800 bg-slate-950/70 p-4 lg:mx-auto lg:max-w-6xl">
      <Button className="w-fit" variant="ghost" onClick={onBack}><ArrowLeft className="h-4 w-4" />{backLabel}</Button>
      <header className="grid gap-5 sm:grid-cols-[128px_minmax(0,1fr)] sm:items-start">
        <div className="grid aspect-[3/4] place-items-center overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
          {person.profileUrl ? <img className="h-full w-full object-cover" src={person.profileUrl} alt={person.names.primary ?? "人物头像"} /> : <UserRound className="h-12 w-12 text-slate-600" />}
        </div>
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold text-slate-50">{person.names.primary}</h1>
          {[person.names.english, person.names.original].filter((value, index, values) => value && value !== person.names.primary && values.indexOf(value) === index).map((name) => <p className="mt-1 text-sm text-slate-400" key={name}>{name}</p>)}
          <div className="mt-3 flex flex-wrap gap-2">
            {person.departments.map((department) => <Badge key={department} variant="secondary">{personDepartmentLabel(department)}</Badge>)}
          </div>
          {(facts.length > 0 || externalLinks.length > 0) && (
            <dl className="mt-4 grid max-w-3xl gap-x-6 gap-y-2 border-y border-slate-800/80 py-3 text-sm sm:grid-cols-2">
              {facts.map((fact) => (
                <div className="grid min-w-0 grid-cols-[3.75rem_minmax(0,1fr)] gap-2" key={fact.label}>
                  <dt className="text-slate-500">{fact.label}</dt>
                  <dd className="min-w-0 text-slate-300">{fact.value}</dd>
                </div>
              ))}
              {externalLinks.length > 0 && (
                <div className="grid grid-cols-[3.75rem_minmax(0,1fr)] gap-2 sm:col-span-2">
                  <dt className="text-slate-500">资料</dt>
                  <dd className="flex flex-wrap gap-2">
                    {externalLinks.map((link) => (
                      <a
                        className="inline-flex items-center gap-1 rounded-full border border-slate-700 px-2.5 py-1 text-xs font-medium text-slate-300 transition hover:border-emerald-300/50 hover:text-emerald-200"
                        href={link.url}
                        key={link.label}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {link.label}<ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </a>
                    ))}
                  </dd>
                </div>
              )}
            </dl>
          )}
          {biography.chinese
            ? <p className="mt-4 max-w-3xl whitespace-pre-wrap text-sm leading-7 text-slate-300">{biography.chinese}</p>
            : <p className="mt-4 text-sm text-slate-500">人物小传待核对后补充。</p>}
        </div>
      </header>

      <section className="grid gap-3" aria-label="WWP 收录作品">
        <div className="flex items-baseline justify-between gap-3 border-b border-slate-800 pb-2">
          <h2 className="text-sm font-semibold tracking-wide text-slate-200">WWP 收录作品</h2>
          <span className="text-xs text-slate-600">{filmography.length} 部</span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {filmography.map((work) => {
            const result = resultByWorkId.get(work.workId);
            return (
              <button className="group overflow-hidden rounded-xl border border-slate-800 bg-slate-900/70 text-left transition hover:-translate-y-0.5 hover:border-emerald-300/50 hover:shadow-xl hover:shadow-black/20 disabled:cursor-default disabled:hover:translate-y-0" disabled={!result} key={work.workId} onClick={() => result && onOpenWork(result)} type="button">
                <div className="aspect-[2/3] bg-slate-950">{result ? <PosterImage alt={result.title} className="h-full w-full object-cover" result={result} /> : <div className="grid h-full place-items-center"><Film className="h-8 w-8 text-slate-700" /></div>}</div>
                <div className="grid gap-2 p-3">
                  <p className="line-clamp-2 text-sm font-semibold text-slate-100">{work.title ?? work.workId}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {work.roleLabels.map((label) => <span className="rounded-full border border-emerald-300/15 bg-emerald-300/[0.06] px-2 py-0.5 text-[10px] font-semibold text-emerald-200/75" key={label}>{label}</span>)}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </section>
  );
}
