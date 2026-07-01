import { Clock3, Coins, Film, HeartHandshake, MessageSquarePlus, Play, ShieldCheck } from "lucide-react";
import { Badge } from "../../components/ui/badge";
import { copy } from "../i18n";

const rules = [
  HeartHandshake,
  Clock3,
  Coins,
  Play,
  MessageSquarePlus,
  ShieldCheck
];

export function HelpPanel() {
  return (
    <div className="grid gap-5">
      <section className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Film className="h-5 w-5 text-emerald-300" />
          <h2 className="text-lg font-semibold text-slate-50">{copy.help.title}</h2>
          <Badge variant="secondary">{copy.help.badge}</Badge>
        </div>
        <p className="max-w-3xl text-sm leading-6 text-slate-400">
          {copy.help.intro}
        </p>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {copy.help.rules.map((rule, index) => {
          const Icon = rules[index];
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
