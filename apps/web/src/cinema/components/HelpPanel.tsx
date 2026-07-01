import { useMemo, useState, type ComponentType, type SVGProps } from "react";
import {
  Archive,
  BookOpen,
  Captions,
  CircleHelp,
  Clock3,
  Coins,
  Database,
  Film,
  GraduationCap,
  HeartHandshake,
  MessageSquarePlus,
  PiggyBank,
  Play,
  Repeat2,
  Search,
  Share2,
  Sparkles,
  Volume2,
  Wrench
} from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "../../components/ui/accordion";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { copy } from "../i18n";

type HelpView = "home" | "faq" | "academy";
type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;
type FaqItem = typeof copy.help.faqItems[number];
type LessonItem = typeof copy.help.lessons[number];

const rules: IconComponent[] = [
  HeartHandshake,
  Clock3,
  Coins,
  Archive,
  Play,
  Repeat2,
  PiggyBank,
  MessageSquarePlus,
  Share2
];

const lessonIcons: IconComponent[] = [
  BookOpen,
  Coins,
  Database,
  Film,
  Captions,
  Volume2,
  Wrench,
  MessageSquarePlus
];

const helpViews: Array<{ id: HelpView; label: string; icon: IconComponent }> = [
  { id: "home", label: copy.help.nav.home, icon: Film },
  { id: "faq", label: copy.help.nav.faq, icon: CircleHelp },
  { id: "academy", label: copy.help.nav.academy, icon: GraduationCap }
];

export function HelpPanel() {
  const [activeView, setActiveView] = useState<HelpView>("home");
  const [faqCategory, setFaqCategory] = useState("all");
  const [faqQuery, setFaqQuery] = useState("");
  const [expandedFaq, setExpandedFaq] = useState<string>(copy.help.faqItems[0]?.question ?? "");
  const [selectedLessonId, setSelectedLessonId] = useState<string>(copy.help.lessons[0]?.id ?? "");

  const normalizedFaqQuery = faqQuery.trim().toLocaleLowerCase("zh-CN");
  const filteredFaqItems = useMemo(
    () =>
      copy.help.faqItems.filter((item) => {
        const categoryMatches = faqCategory === "all" || item.category === faqCategory;
        if (!categoryMatches) return false;
        if (!normalizedFaqQuery) return true;
        return `${item.question} ${item.answer}`.toLocaleLowerCase("zh-CN").includes(normalizedFaqQuery);
      }),
    [faqCategory, normalizedFaqQuery]
  );

  const selectedLesson =
    copy.help.lessons.find((lesson) => lesson.id === selectedLessonId) ?? copy.help.lessons[0];

  return (
    <Tabs className="grid gap-5" value={activeView} onValueChange={(value) => setActiveView(value as HelpView)}>
      <section className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Film className="h-5 w-5 text-emerald-300" />
          <h2 className="text-lg font-semibold text-slate-50">{copy.help.title}</h2>
        </div>

        <TabsList className="justify-start bg-slate-950/72">
          {helpViews.map((view) => {
            const Icon = view.icon;
            return (
              <TabsTrigger
                className="data-[state=active]:bg-emerald-400 data-[state=active]:text-slate-950"
                key={view.id}
                value={view.id}
              >
                <Icon className="h-4 w-4" />
                {view.label}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </section>

      <TabsContent className="mt-0" value="home">
        <HelpHome />
      </TabsContent>
      <TabsContent className="mt-0" value="faq">
        <HelpFaq
          expandedFaq={expandedFaq}
          faqCategory={faqCategory}
          faqQuery={faqQuery}
          filteredFaqItems={filteredFaqItems}
          onExpandedFaqChange={setExpandedFaq}
          onFaqCategoryChange={setFaqCategory}
          onFaqQueryChange={setFaqQuery}
        />
      </TabsContent>
      <TabsContent className="mt-0" value="academy">
        <HelpAcademy
          selectedLesson={selectedLesson}
          selectedLessonId={selectedLessonId}
          onSelectedLessonChange={setSelectedLessonId}
        />
      </TabsContent>
    </Tabs>
  );
}

function HelpHome() {
  return (
    <div className="grid gap-5">
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {copy.help.rules.map((rule, index) => {
          const Icon = rules[index] ?? Sparkles;
          return (
            <article
              className="grid min-w-0 content-start gap-3 rounded-lg border border-slate-800 bg-slate-950/72 p-4"
              key={rule.title}
            >
              <div className="flex items-center gap-2">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-slate-900 text-amber-200">
                  <Icon className="h-4 w-4" />
                </span>
                <h3 className="text-sm font-semibold text-slate-50">{rule.title}</h3>
              </div>
              <p className="text-sm leading-6 text-slate-400">{rule.body}</p>
            </article>
          );
        })}
      </section>

      <section className="rounded-lg border border-emerald-300/20 bg-emerald-300/8 p-4">
        <h3 className="text-sm font-semibold text-emerald-100">{copy.help.flowTitle}</h3>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          {copy.help.flowBody}
        </p>
      </section>
    </div>
  );
}

function HelpFaq({
  expandedFaq,
  faqCategory,
  faqQuery,
  filteredFaqItems,
  onExpandedFaqChange,
  onFaqCategoryChange,
  onFaqQueryChange
}: {
  expandedFaq: string;
  faqCategory: string;
  faqQuery: string;
  filteredFaqItems: readonly FaqItem[];
  onExpandedFaqChange: (value: string) => void;
  onFaqCategoryChange: (value: string) => void;
  onFaqQueryChange: (value: string) => void;
}) {
  return (
    <section className="grid gap-4 rounded-lg border border-slate-800 bg-slate-950/72 p-4">
      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_20rem] md:items-end">
        <div className="grid gap-1">
          <h3 className="text-base font-semibold text-slate-50">{copy.help.faqTitle}</h3>
          <p className="max-w-3xl text-sm leading-6 text-slate-400">{copy.help.faqDescription}</p>
        </div>
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <Input
            className="pl-9"
            value={faqQuery}
            placeholder={copy.help.faqSearchPlaceholder}
            onChange={(event) => onFaqQueryChange(event.target.value)}
          />
        </label>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {copy.help.faqCategories.map((category) => {
          const active = faqCategory === category.id;
          return (
            <Button
              aria-pressed={active}
              className="shrink-0"
              key={category.id}
              type="button"
              variant={active ? "secondary" : "ghost"}
              size="sm"
              onClick={() => onFaqCategoryChange(category.id)}
            >
              {category.label}
            </Button>
          );
        })}
      </div>

      <Accordion className="grid gap-2" type="single" collapsible value={expandedFaq} onValueChange={onExpandedFaqChange}>
        {filteredFaqItems.length > 0 ? (
          filteredFaqItems.map((item) => (
            <AccordionItem key={item.question} value={item.question}>
              <AccordionTrigger>{item.question}</AccordionTrigger>
              <AccordionContent>{item.answer}</AccordionContent>
            </AccordionItem>
          ))
        ) : (
          <p className="rounded-lg border border-slate-800 bg-slate-900/45 px-4 py-6 text-sm text-slate-400">
            {copy.help.faqEmpty}
          </p>
        )}
      </Accordion>
    </section>
  );
}

function HelpAcademy({
  selectedLesson,
  selectedLessonId,
  onSelectedLessonChange
}: {
  selectedLesson: LessonItem;
  selectedLessonId: string;
  onSelectedLessonChange: (value: string) => void;
}) {
  return (
    <section className="grid gap-4">
      <div className="rounded-lg border border-slate-800 bg-slate-950/72 p-4">
        <h3 className="text-base font-semibold text-slate-50">{copy.help.lessonsTitle}</h3>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-400">{copy.help.lessonsDescription}</p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid gap-3 md:grid-cols-2">
          {copy.help.lessons.map((lesson, index) => {
            const Icon = lessonIcons[index] ?? BookOpen;
            const active = selectedLessonId === lesson.id;
            return (
              <button
                aria-pressed={active}
                className={`grid min-w-0 content-start gap-3 rounded-lg border p-4 text-left transition-colors ${
                  active
                    ? "border-emerald-300/60 bg-emerald-300/10"
                    : "border-slate-800 bg-slate-950/72 hover:border-slate-700 hover:bg-slate-900/80"
                }`}
                key={lesson.id}
                type="button"
                onClick={() => onSelectedLessonChange(lesson.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-slate-900 text-cyan-200">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="rounded-full border border-slate-700 px-2 py-0.5 text-xs font-semibold text-slate-400">
                    {lesson.kicker}
                  </span>
                </div>
                <div className="grid gap-1">
                  <h4 className="text-sm font-semibold text-slate-50">{lesson.title}</h4>
                  <p className="text-sm leading-6 text-slate-400">{lesson.summary}</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {lesson.tags.map((tag) => (
                    <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs text-slate-400" key={tag}>
                      {tag}
                    </span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>

        <aside className="h-fit rounded-lg border border-emerald-300/20 bg-emerald-300/8 p-4 xl:sticky xl:top-24">
          <div className="flex items-start justify-between gap-3">
            <div className="grid gap-1">
              <p className="text-xs font-semibold text-emerald-200">{selectedLesson.kicker}</p>
              <h3 className="text-base font-semibold text-slate-50">{selectedLesson.title}</h3>
            </div>
            <span className="rounded-md bg-emerald-300 px-2 py-1 text-xs font-bold text-slate-950">
              {copy.help.lessonOpenLabel}
            </span>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-300">{selectedLesson.summary}</p>
          <ul className="mt-4 grid gap-3">
            {selectedLesson.points.map((point) => (
              <li className="flex gap-2 text-sm leading-6 text-slate-300" key={point}>
                <Sparkles className="mt-1 h-4 w-4 shrink-0 text-amber-200" />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </section>
  );
}
