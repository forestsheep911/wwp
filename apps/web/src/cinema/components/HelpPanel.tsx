import { Clock3, Coins, Film, HeartHandshake, MessageSquarePlus, Play, ShieldCheck } from "lucide-react";
import { Badge } from "../../components/ui/badge";

const rules = [
  {
    icon: HeartHandshake,
    title: "这是家里人和朋友的小片库",
    body: "它不是公开视频网站，也不追求所有内容都随点随播。片源、缓存和播放流量都放在家庭账户里，所以需要一点规则来避免浪费。"
  },
  {
    icon: Clock3,
    title: "第一次看之前要先准备",
    body: "没有缓存过的片子，点规格后会进入准备队列。系统会去确认片源、搬到播放缓存、检查是否适合在线播放；准备完成后才会打开播放器。"
  },
  {
    icon: Coins,
    title: "准备和观看都会花代币",
    body: "准备一部片会花准备代币；真正开始观看时，还会按播放规则花观看代币。代币是为了让大家少点误触、少重复准备大文件。"
  },
  {
    icon: Play,
    title: "缓存命中会更快",
    body: "如果别人已经准备过，或这部片还在缓存期内，你可以直接播放。短时间内重看同一部片通常不会重复收取观看代币。"
  },
  {
    icon: MessageSquarePlus,
    title: "找不到片可以请求",
    body: "搜索不到、规格不对、或者想补片，可以在账号菜单里提交 Request movie。管理员看到后会决定是否补进片库。"
  },
  {
    icon: ShieldCheck,
    title: "账号和代币别外传",
    body: "这个站只给熟人使用。通行码、播放链接和缓存内容都不要公开传播；如果代币不够，找管理员补。"
  }
];

export function HelpPanel() {
  return (
    <div className="grid gap-5">
      <section className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Film className="h-5 w-5 text-emerald-300" />
          <h2 className="text-lg font-semibold text-slate-50">使用说明</h2>
          <Badge variant="secondary">家庭规则</Badge>
        </div>
        <p className="max-w-3xl text-sm leading-6 text-slate-400">
          WWP Cinema 是给家里人和朋友临时看片用的。最大不同是：很多片子不是天然在线流媒体，
          需要先准备成可在线播放的缓存；准备和观看都会消耗 🍀 代币。
        </p>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rules.map((rule) => {
          const Icon = rule.icon;
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
        <h3 className="text-sm font-semibold text-emerald-100">简单流程</h3>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          先在推荐、电影、电视、动画里挑片；选择一个规格后，如果还没准备好，就等它完成缓存；
          准备完成后点 Play 在线观看。看过的片子会进 History，已缓存的片子可以从账号菜单里的 Cached 找到。
        </p>
      </section>
    </div>
  );
}
