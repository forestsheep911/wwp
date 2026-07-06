export type WakeQuizQuestion = {
  id: string;
  category: string;
  prompt: string;
  options: readonly [string, string, string, string];
  answerIndex: number;
  note: string;
};

type DirectorFact = {
  film: string;
  director: string;
};

type RoleFact = {
  work: string;
  role: string;
  actor: string;
};

type RegionFact = {
  work: string;
  region: string;
};

type ManualQuestionInput = {
  category: string;
  prompt: string;
  answer: string;
  options: readonly [string, string, string, string];
  note: string;
};

type TvFact = {
  clue: string;
  answer: string;
};

const optionLetters = ["A", "B", "C", "D"] as const;

const filmDirectorFacts: readonly DirectorFact[] = [
  { film: "《公民凯恩》", director: "奥逊·威尔斯" },
  { film: "《教父》", director: "弗朗西斯·福特·科波拉" },
  { film: "《教父2》", director: "弗朗西斯·福特·科波拉" },
  { film: "《现代启示录》", director: "弗朗西斯·福特·科波拉" },
  { film: "《出租车司机》", director: "马丁·斯科塞斯" },
  { film: "《好家伙》", director: "马丁·斯科塞斯" },
  { film: "《愤怒的公牛》", director: "马丁·斯科塞斯" },
  { film: "《低俗小说》", director: "昆汀·塔伦蒂诺" },
  { film: "《落水狗》", director: "昆汀·塔伦蒂诺" },
  { film: "《杀死比尔》", director: "昆汀·塔伦蒂诺" },
  { film: "《2001太空漫游》", director: "斯坦利·库布里克" },
  { film: "《发条橙》", director: "斯坦利·库布里克" },
  { film: "《闪灵》", director: "斯坦利·库布里克" },
  { film: "《七武士》", director: "黑泽明" },
  { film: "《罗生门》", director: "黑泽明" },
  { film: "《乱》", director: "黑泽明" },
  { film: "《东京物语》", director: "小津安二郎" },
  { film: "《晚春》", director: "小津安二郎" },
  { film: "《迷魂记》", director: "阿尔弗雷德·希区柯克" },
  { film: "《惊魂记》", director: "阿尔弗雷德·希区柯克" },
  { film: "《西北偏北》", director: "阿尔弗雷德·希区柯克" },
  { film: "《八部半》", director: "费德里科·费里尼" },
  { film: "《甜蜜的生活》", director: "费德里科·费里尼" },
  { film: "《四百击》", director: "弗朗索瓦·特吕弗" },
  { film: "《精疲力尽》", director: "让-吕克·戈达尔" },
  { film: "《野草莓》", director: "英格玛·伯格曼" },
  { film: "《第七封印》", director: "英格玛·伯格曼" },
  { film: "《蓝丝绒》", director: "大卫·林奇" },
  { film: "《穆赫兰道》", director: "大卫·林奇" },
  { film: "《银翼杀手》", director: "雷德利·斯科特" },
  { film: "《异形》", director: "雷德利·斯科特" },
  { film: "《阿拉伯的劳伦斯》", director: "大卫·里恩" },
  { film: "《桂河大桥》", director: "大卫·里恩" },
  { film: "《大白鲨》", director: "史蒂文·斯皮尔伯格" },
  { film: "《辛德勒的名单》", director: "史蒂文·斯皮尔伯格" },
  { film: "《E.T.外星人》", director: "史蒂文·斯皮尔伯格" },
  { film: "《夺宝奇兵》", director: "史蒂文·斯皮尔伯格" },
  { film: "《星球大战》", director: "乔治·卢卡斯" },
  { film: "《美国风情画》", director: "乔治·卢卡斯" },
  { film: "《泰坦尼克号》", director: "詹姆斯·卡梅隆" },
  { film: "《终结者2：审判日》", director: "詹姆斯·卡梅隆" },
  { film: "《阿凡达》", director: "詹姆斯·卡梅隆" },
  { film: "《疯狂的麦克斯：狂暴之路》", director: "乔治·米勒" },
  { film: "《寄生虫》", director: "奉俊昊" },
  { film: "《杀人回忆》", director: "奉俊昊" },
  { film: "《老男孩》", director: "朴赞郁" },
  { film: "《燃烧》", director: "李沧东" },
  { film: "《一一》", director: "杨德昌" },
  { film: "《牯岭街少年杀人事件》", director: "杨德昌" },
  { film: "《悲情城市》", director: "侯孝贤" },
  { film: "《花样年华》", director: "王家卫" },
  { film: "《重庆森林》", director: "王家卫" },
  { film: "《春光乍泄》", director: "王家卫" },
  { film: "《霸王别姬》", director: "陈凯歌" },
  { film: "《黄土地》", director: "陈凯歌" },
  { film: "《红高粱》", director: "张艺谋" },
  { film: "《活着》", director: "张艺谋" },
  { film: "《英雄》", director: "张艺谋" },
  { film: "《卧虎藏龙》", director: "李安" },
  { film: "《饮食男女》", director: "李安" },
  { film: "《少年派的奇幻漂流》", director: "李安" },
  { film: "《小偷家族》", director: "是枝裕和" },
  { film: "《无人知晓》", director: "是枝裕和" },
  { film: "《千与千寻》", director: "宫崎骏" },
  { film: "《龙猫》", director: "宫崎骏" },
  { film: "《幽灵公主》", director: "宫崎骏" },
  { film: "《你的名字。》", director: "新海诚" },
  { film: "《铃芽之旅》", director: "新海诚" },
  { film: "《盗梦空间》", director: "克里斯托弗·诺兰" },
  { film: "《奥本海默》", director: "克里斯托弗·诺兰" },
  { film: "《蝙蝠侠：黑暗骑士》", director: "克里斯托弗·诺兰" },
  { film: "《爱乐之城》", director: "达米恩·查泽雷" },
  { film: "《爆裂鼓手》", director: "达米恩·查泽雷" },
  { film: "《月光男孩》", director: "巴里·詹金斯" },
  { film: "《伯德小姐》", director: "格蕾塔·葛韦格" },
  { film: "《芭比》", director: "格蕾塔·葛韦格" },
  { film: "《沙丘》", director: "丹尼斯·维伦纽瓦" },
  { film: "《降临》", director: "丹尼斯·维伦纽瓦" },
  { film: "《边境杀手》", director: "丹尼斯·维伦纽瓦" },
  { film: "《无依之地》", director: "赵婷" },
  { film: "《地心引力》", director: "阿方索·卡隆" },
  { film: "《罗马》", director: "阿方索·卡隆" },
  { film: "《鸟人》", director: "亚历杭德罗·冈萨雷斯·伊纳里图" },
  { film: "《荒野猎人》", director: "亚历杭德罗·冈萨雷斯·伊纳里图" },
  { film: "《潘神的迷宫》", director: "吉尔莫·德尔·托罗" },
  { film: "《水形物语》", director: "吉尔莫·德尔·托罗" },
  { film: "《布达佩斯大饭店》", director: "韦斯·安德森" },
  { film: "《法兰西特派》", director: "韦斯·安德森" },
  { film: "《社交网络》", director: "大卫·芬奇" },
  { film: "《搏击俱乐部》", director: "大卫·芬奇" },
  { film: "《七宗罪》", director: "大卫·芬奇" },
  { film: "《十二怒汉》", director: "西德尼·吕美特" },
  { film: "《电视台风云》", director: "西德尼·吕美特" }
];

const extraDirectorDistractors = [
  "比利·怀尔德",
  "约翰·福特",
  "霍华德·霍克斯",
  "萨蒂亚吉特·雷伊",
  "阿巴斯·基阿鲁斯达米",
  "阿涅斯·瓦尔达",
  "简·坎皮恩",
  "保罗·托马斯·安德森",
  "萨姆·门德斯",
  "索菲亚·科波拉"
];

const roleFacts: readonly RoleFact[] = [
  { work: "《黑暗骑士》", role: "小丑", actor: "希斯·莱杰" },
  { work: "《教父》", role: "维托·柯里昂", actor: "马龙·白兰度" },
  { work: "《出租车司机》", role: "特拉维斯·比克尔", actor: "罗伯特·德尼罗" },
  { work: "《沉默的羔羊》", role: "汉尼拔·莱克特", actor: "安东尼·霍普金斯" },
  { work: "《沉默的羔羊》", role: "克拉丽丝·史达琳", actor: "朱迪·福斯特" },
  { work: "《阿甘正传》", role: "阿甘", actor: "汤姆·汉克斯" },
  { work: "《泰坦尼克号》", role: "杰克", actor: "莱昂纳多·迪卡普里奥" },
  { work: "《泰坦尼克号》", role: "露丝", actor: "凯特·温斯莱特" },
  { work: "《黑客帝国》", role: "尼奥", actor: "基努·里维斯" },
  { work: "《黑客帝国》", role: "崔妮蒂", actor: "凯瑞-安·莫斯" },
  { work: "《黑客帝国》", role: "墨菲斯", actor: "劳伦斯·菲什伯恩" },
  { work: "《杀死比尔》", role: "新娘", actor: "乌玛·瑟曼" },
  { work: "《指环王》系列", role: "弗罗多", actor: "伊利亚·伍德" },
  { work: "《指环王》系列", role: "甘道夫", actor: "伊恩·麦克莱恩" },
  { work: "《哈利·波特》系列", role: "哈利·波特", actor: "丹尼尔·雷德克里夫" },
  { work: "《哈利·波特》系列", role: "赫敏", actor: "艾玛·沃森" },
  { work: "《霸王别姬》", role: "程蝶衣", actor: "张国荣" },
  { work: "《霸王别姬》", role: "段小楼", actor: "张丰毅" },
  { work: "《霸王别姬》", role: "菊仙", actor: "巩俐" },
  { work: "《花样年华》", role: "周慕云", actor: "梁朝伟" },
  { work: "《花样年华》", role: "苏丽珍", actor: "张曼玉" },
  { work: "《无间道》", role: "陈永仁", actor: "梁朝伟" },
  { work: "《无间道》", role: "刘建明", actor: "刘德华" },
  { work: "《卧虎藏龙》", role: "俞秀莲", actor: "杨紫琼" },
  { work: "《卧虎藏龙》", role: "李慕白", actor: "周润发" },
  { work: "《卧虎藏龙》", role: "玉娇龙", actor: "章子怡" },
  { work: "《末代皇帝》", role: "成年溥仪", actor: "尊龙" },
  { work: "《小丑》", role: "亚瑟·弗莱克", actor: "华金·菲尼克斯" },
  { work: "《芭比》", role: "芭比", actor: "玛格特·罗比" },
  { work: "《芭比》", role: "肯", actor: "瑞恩·高斯林" },
  { work: "《奥本海默》", role: "J. 罗伯特·奥本海默", actor: "基里安·墨菲" },
  { work: "《瞬息全宇宙》", role: "伊芙琳", actor: "杨紫琼" },
  { work: "《瞬息全宇宙》", role: "威门", actor: "关继威" },
  { work: "《寄生虫》", role: "金基泽", actor: "宋康昊" },
  { work: "《老男孩》", role: "吴大秀", actor: "崔岷植" },
  { work: "《碟中谍》系列", role: "伊森·亨特", actor: "汤姆·克鲁斯" },
  { work: "《夺宝奇兵》系列", role: "印第安纳·琼斯", actor: "哈里森·福特" },
  { work: "《饥饿游戏》系列", role: "凯特尼斯", actor: "詹妮弗·劳伦斯" },
  { work: "《这个杀手不太冷》", role: "莱昂", actor: "让·雷诺" },
  { work: "《这个杀手不太冷》", role: "玛蒂尔达", actor: "娜塔莉·波特曼" },
  { work: "《罗马假日》", role: "安妮公主", actor: "奥黛丽·赫本" },
  { work: "《乱世佳人》", role: "斯嘉丽·奥哈拉", actor: "费雯·丽" }
];

const extraActorDistractors = [
  "梅丽尔·斯特里普",
  "丹泽尔·华盛顿",
  "杰克·尼科尔森",
  "妮可·基德曼",
  "布拉德·皮特",
  "娜塔莉·波特曼",
  "安妮·海瑟薇",
  "加里·奥德曼",
  "蒂尔达·斯文顿",
  "小罗伯特·唐尼"
];

const regionFacts: readonly RegionFact[] = [
  { work: "《罗马》", region: "墨西哥" },
  { work: "《寄生虫》", region: "韩国" },
  { work: "《分手的决心》", region: "韩国" },
  { work: "《小偷家族》", region: "日本" },
  { work: "《千与千寻》", region: "日本" },
  { work: "《菊次郎的夏天》", region: "日本" },
  { work: "《花样年华》", region: "中国香港" },
  { work: "《无间道》", region: "中国香港" },
  { work: "《一一》", region: "中国台湾" },
  { work: "《牯岭街少年杀人事件》", region: "中国台湾" },
  { work: "《天堂电影院》", region: "意大利" },
  { work: "《美丽人生》", region: "意大利" },
  { work: "《八部半》", region: "意大利" },
  { work: "《天使爱美丽》", region: "法国" },
  { work: "《四百击》", region: "法国" },
  { work: "《精疲力尽》", region: "法国" },
  { work: "《一次别离》", region: "伊朗" },
  { work: "《小鞋子》", region: "伊朗" },
  { work: "《何以为家》", region: "黎巴嫩" },
  { work: "《诗人悲歌》", region: "印度" },
  { work: "《大地之歌》", region: "印度" },
  { work: "《中央车站》", region: "巴西" },
  { work: "《上帝之城》", region: "巴西" },
  { work: "《潘神的迷宫》", region: "西班牙" },
  { work: "《对她说》", region: "西班牙" },
  { work: "《窃听风暴》", region: "德国" },
  { work: "《再见列宁》", region: "德国" },
  { work: "《第七封印》", region: "瑞典" },
  { work: "《野草莓》", region: "瑞典" },
  { work: "《狩猎》", region: "丹麦" },
  { work: "《酒精计划》", region: "丹麦" },
  { work: "《鲸骑士》", region: "新西兰" },
  { work: "《钢琴课》", region: "新西兰" },
  { work: "《霸王别姬》", region: "中国内地" },
  { work: "《红高粱》", region: "中国内地" },
  { work: "《悲情城市》", region: "中国台湾" },
  { work: "《燃烧》", region: "韩国" },
  { work: "《老男孩》", region: "韩国" }
];

const regionPool = [
  "美国",
  "英国",
  "法国",
  "德国",
  "意大利",
  "西班牙",
  "日本",
  "韩国",
  "伊朗",
  "印度",
  "巴西",
  "丹麦",
  "瑞典",
  "墨西哥",
  "中国内地",
  "中国香港",
  "中国台湾",
  "新西兰",
  "黎巴嫩"
];

const oscarBestPictureWinners = [
  "《乱世佳人》",
  "《卡萨布兰卡》",
  "《彗星美人》",
  "《码头风云》",
  "《桂河大桥》",
  "《宾虚》",
  "《公寓春光》",
  "《西区故事》",
  "《阿拉伯的劳伦斯》",
  "《音乐之声》",
  "《午夜牛郎》",
  "《法国贩毒网》",
  "《教父》",
  "《骗中骗》",
  "《教父2》",
  "《飞越疯人院》",
  "《洛奇》",
  "《安妮·霍尔》",
  "《猎鹿人》",
  "《克莱默夫妇》",
  "《普通人》",
  "《火的战车》",
  "《甘地传》",
  "《母女情深》",
  "《莫扎特传》",
  "《走出非洲》",
  "《野战排》",
  "《末代皇帝》",
  "《雨人》",
  "《为黛西小姐开车》",
  "《与狼共舞》",
  "《沉默的羔羊》",
  "《不可饶恕》",
  "《辛德勒的名单》",
  "《阿甘正传》",
  "《勇敢的心》",
  "《英国病人》",
  "《泰坦尼克号》",
  "《莎翁情史》",
  "《美国丽人》",
  "《角斗士》",
  "《美丽心灵》",
  "《芝加哥》",
  "《指环王：王者归来》",
  "《百万美元宝贝》",
  "《撞车》",
  "《无间行者》",
  "《老无所依》",
  "《贫民窟的百万富翁》",
  "《拆弹部队》",
  "《国王的演讲》",
  "《艺术家》",
  "《逃离德黑兰》",
  "《为奴十二年》",
  "《鸟人》",
  "《聚焦》",
  "《月光男孩》",
  "《水形物语》",
  "《绿皮书》",
  "《寄生虫》",
  "《无依之地》",
  "《健听女孩》",
  "《瞬息全宇宙》",
  "《奥本海默》"
];

const oscarBestPictureDistractors = [
  "《公民凯恩》",
  "《大白鲨》",
  "《星球大战》",
  "《E.T.外星人》",
  "《肖申克的救赎》",
  "《低俗小说》",
  "《阿凡达》",
  "《盗梦空间》",
  "《断背山》",
  "《社交网络》",
  "《爱乐之城》",
  "《敦刻尔克》",
  "《罗马》",
  "《黑豹》",
  "《婚姻故事》",
  "《好家伙》",
  "《现代启示录》",
  "《七武士》",
  "《迷魂记》",
  "《花样年华》",
  "《饮食男女》",
  "《银翼杀手》",
  "《黑客帝国》",
  "《疯狂的麦克斯：狂暴之路》",
  "《伯德小姐》",
  "《逃出绝命镇》",
  "《血色将至》",
  "《荒野猎人》",
  "《降临》",
  "《穆赫兰道》",
  "《壮志凌云：独行侠》",
  "《犬之力》"
];

const animatedFeatureWinners = [
  "《怪物史瑞克》",
  "《千与千寻》",
  "《海底总动员》",
  "《超人总动员》",
  "《超级无敌掌门狗：人兔的诅咒》",
  "《快乐的大脚》",
  "《料理鼠王》",
  "《机器人总动员》",
  "《飞屋环游记》",
  "《玩具总动员3》",
  "《兰戈》",
  "《勇敢传说》",
  "《冰雪奇缘》",
  "《超能陆战队》",
  "《头脑特工队》",
  "《疯狂动物城》",
  "《寻梦环游记》",
  "《蜘蛛侠：平行宇宙》",
  "《玩具总动员4》",
  "《心灵奇旅》",
  "《魔法满屋》",
  "《吉尔莫·德尔·托罗的匹诺曹》",
  "《你想活出怎样的人生》"
];

const animatedFeatureDistractors = [
  "《怪兽电力公司》",
  "《驯龙高手》",
  "《疯狂原始人》",
  "《功夫熊猫》",
  "《鬼妈妈》",
  "《你的名字。》",
  "《辉夜姬物语》",
  "《海洋奇缘》",
  "《狼行者》",
  "《穿靴子的猫2》",
  "《红辣椒》",
  "《攻壳机动队》",
  "《萤火虫之墓》",
  "《大坏狐狸的故事》",
  "《玛丽和马克思》",
  "《疯狂约会美丽都》"
];

const manualQuestions: readonly ManualQuestionInput[] = [
  {
    category: "电影语言",
    prompt: "电影里说的“蒙太奇”最接近哪种意思？",
    answer: "通过镜头组接制造节奏和意义",
    options: ["通过镜头组接制造节奏和意义", "只用自然光拍摄", "演员即兴创作台词", "把影片改成黑白画面"],
    note: "蒙太奇的重点在镜头之间的连接，而不只是单个画面。"
  },
  {
    category: "电影语言",
    prompt: "“长镜头”通常指什么？",
    answer: "单个镜头持续时间较长，中途不明显剪切",
    options: ["单个镜头持续时间较长，中途不明显剪切", "镜头焦距必须很长", "只拍远景不拍近景", "一部电影只有一个场景"],
    note: "长镜头经常用来保留空间连续性和表演节奏。"
  },
  {
    category: "电影语言",
    prompt: "“景深”描述的是画面中的哪件事？",
    answer: "前景到背景有多少区域保持清晰",
    options: ["前景到背景有多少区域保持清晰", "摄影棚的实际高度", "镜头运动的速度", "声音的混响长度"],
    note: "深焦镜头会让前后景都更清楚，浅景深则突出焦点主体。"
  },
  {
    category: "电影语言",
    prompt: "“跳切”最典型的效果是什么？",
    answer: "同一动作或空间被突兀剪接，制造断裂感",
    options: ["同一动作或空间被突兀剪接，制造断裂感", "镜头从高处跳到低处", "角色突然进入歌舞段落", "画面亮度突然提高"],
    note: "法国新浪潮常用跳切打破传统连续剪辑的顺滑感。"
  },
  {
    category: "电影语言",
    prompt: "“场面调度”主要关注什么？",
    answer: "演员、布景、光线和摄影机在空间中的安排",
    options: ["演员、布景、光线和摄影机在空间中的安排", "影片上映城市的排片", "后期字幕的翻译顺序", "电影票价的设定"],
    note: "场面调度把空间、运动和视觉关系组织成可读的戏。"
  },
  {
    category: "电影语言",
    prompt: "“画外音”指的是哪类声音？",
    answer: "来自画面外、但被观众听到的叙述或声音",
    options: ["来自画面外、但被观众听到的叙述或声音", "电影院外面的环境噪音", "演员没有开口时的口型", "没有经过混音的同期声"],
    note: "画外音可以是旁白，也可以是画面外角色发出的声音。"
  },
  {
    category: "电影语言",
    prompt: "“拟音”在后期里通常负责什么？",
    answer: "重新制作脚步、衣物摩擦等动作声音",
    options: ["重新制作脚步、衣物摩擦等动作声音", "给电影重新配色", "为海报设计字体", "统计票房数据"],
    note: "拟音让动作声音更清晰、更有质感。"
  },
  {
    category: "电影语言",
    prompt: "“主观镜头”常用来模拟什么？",
    answer: "角色的视角或感知",
    options: ["角色的视角或感知", "摄影师的工作日程", "观众席的位置", "制片公司的财务视角"],
    note: "主观镜头让观众短暂进入角色看见世界的方式。"
  },
  {
    category: "电影语言",
    prompt: "“反打镜头”常出现在什么场景？",
    answer: "两人对话时在双方视角之间切换",
    options: ["两人对话时在双方视角之间切换", "追车戏中车辆倒退", "字幕翻译时反复校对", "影院倒片检查胶片"],
    note: "正反打是经典对话剪辑的基础。"
  },
  {
    category: "电影语言",
    prompt: "“麦格芬”在叙事中通常是什么？",
    answer: "推动人物行动、但本身细节不一定重要的目标物",
    options: ["推动人物行动、但本身细节不一定重要的目标物", "专门拍食物的镜头", "导演的客串角色", "影片里的片尾彩蛋"],
    note: "希区柯克常被拿来解释这个概念。"
  },
  {
    category: "电影语言",
    prompt: "“类型片”里的“类型”主要指什么？",
    answer: "观众熟悉的一组叙事规则、情境和风格约定",
    options: ["观众熟悉的一组叙事规则、情境和风格约定", "胶片的宽度", "演员的合同类别", "电影节报名表的编号"],
    note: "西部片、黑色电影、恐怖片都依赖类型约定。"
  },
  {
    category: "电影语言",
    prompt: "“黑色电影”常见的气质是？",
    answer: "阴影浓重、道德暧昧、犯罪或宿命感强",
    options: ["阴影浓重、道德暧昧、犯罪或宿命感强", "全片必须是彩色喜剧", "只拍自然纪录素材", "没有城市夜景"],
    note: "黑色电影不是单纯指黑白画面，而是一整套氛围。"
  },
  {
    category: "电影语言",
    prompt: "“新现实主义”电影最常被联想到哪个国家？",
    answer: "意大利",
    options: ["意大利", "加拿大", "泰国", "挪威"],
    note: "意大利新现实主义常强调普通人生活、实景和战后处境。"
  },
  {
    category: "电影语言",
    prompt: "“法国新浪潮”常被联想到哪位导演？",
    answer: "让-吕克·戈达尔",
    options: ["让-吕克·戈达尔", "詹姆斯·卡梅隆", "彼得·杰克逊", "乔治·卢卡斯"],
    note: "戈达尔和特吕弗都是法国新浪潮的重要名字。"
  },
  {
    category: "电影语言",
    prompt: "“Cinemascope / 宽银幕”最直接改变了什么？",
    answer: "画面的横向比例和空间展开",
    options: ["画面的横向比例和空间展开", "演员的表演方法", "电影票的纸张材质", "字幕必须放在画面中央"],
    note: "宽银幕让横向调度、风景和群戏有了更大的展示面。"
  },
  {
    category: "电影语言",
    prompt: "“定场镜头”通常用来做什么？",
    answer: "交代场景位置、空间关系或氛围",
    options: ["交代场景位置、空间关系或氛围", "证明演员已经到片场", "把片尾字幕提前出现", "隐藏所有背景信息"],
    note: "定场镜头让观众知道下一场戏发生在哪里。"
  },
  {
    category: "电影语言",
    prompt: "“低角度镜头”经常会让人物显得怎样？",
    answer: "更有压迫感或权力感",
    options: ["更有压迫感或权力感", "一定更滑稽", "一定更渺小", "完全没有视觉影响"],
    note: "镜头高度会影响观众对人物力量关系的感受。"
  },
  {
    category: "电影语言",
    prompt: "“冷开放”在剧集或电影中指什么？",
    answer: "片头字幕前直接进入一段剧情",
    options: ["片头字幕前直接进入一段剧情", "拍摄现场温度很低", "首映礼没有观众", "电影没有配乐"],
    note: "冷开放常用来迅速抓住注意力。"
  },
  {
    category: "电影语言",
    prompt: "“非线性叙事”指什么？",
    answer: "故事不按事件发生顺序展开",
    options: ["故事不按事件发生顺序展开", "电影没有主角", "所有镜头都不能移动", "对白必须押韵"],
    note: "倒叙、插叙、多线并置都可能构成非线性叙事。"
  },
  {
    category: "电影语言",
    prompt: "“Diegetic sound / 叙事内声音”是指什么？",
    answer: "故事世界中的角色也能听到的声音",
    options: ["故事世界中的角色也能听到的声音", "只给观众听的背景配乐", "电影院音响的电流声", "后期人员的工作提示音"],
    note: "角色打开收音机听到的歌，就是典型叙事内声音。"
  },
  {
    category: "奖项与电影节",
    prompt: "戛纳电影节最高奖通常被称为？",
    answer: "金棕榈奖",
    options: ["金棕榈奖", "金狮奖", "金熊奖", "金马奖"],
    note: "金棕榈是戛纳最具代表性的最高荣誉。"
  },
  {
    category: "奖项与电影节",
    prompt: "威尼斯电影节最高奖通常被称为？",
    answer: "金狮奖",
    options: ["金狮奖", "金棕榈奖", "金熊奖", "金鸡奖"],
    note: "威尼斯电影节的最高奖是金狮奖。"
  },
  {
    category: "奖项与电影节",
    prompt: "柏林电影节最高奖通常被称为？",
    answer: "金熊奖",
    options: ["金熊奖", "金狮奖", "金棕榈奖", "金像奖"],
    note: "柏林电影节最高奖是金熊奖。"
  },
  {
    category: "奖项与电影节",
    prompt: "奥斯卡奖由哪个机构颁发？",
    answer: "美国电影艺术与科学学院",
    options: ["美国电影艺术与科学学院", "英国电影学院", "戛纳电影节组委会", "美国导演工会"],
    note: "奥斯卡的正式颁奖机构是 Academy of Motion Picture Arts and Sciences。"
  },
  {
    category: "奖项与电影节",
    prompt: "英国电影学院奖通常简称为？",
    answer: "BAFTA",
    options: ["BAFTA", "César", "Goya", "Saturn"],
    note: "BAFTA 是英国电影学院奖的常用简称。"
  },
  {
    category: "奖项与电影节",
    prompt: "法国电影界的重要奖项是？",
    answer: "凯撒奖",
    options: ["凯撒奖", "戈雅奖", "金鸡奖", "蓝龙奖"],
    note: "凯撒奖常被视为法国电影的重要年度奖项。"
  },
  {
    category: "奖项与电影节",
    prompt: "西班牙电影界的重要奖项是？",
    answer: "戈雅奖",
    options: ["戈雅奖", "凯撒奖", "金像奖", "奥斯卡奖"],
    note: "戈雅奖是西班牙电影的重要奖项。"
  },
  {
    category: "奖项与电影节",
    prompt: "香港电影金像奖主要面向哪个地区电影？",
    answer: "中国香港",
    options: ["中国香港", "法国", "韩国", "墨西哥"],
    note: "香港电影金像奖是香港电影工业的重要年度奖项。"
  },
  {
    category: "奖项与电影节",
    prompt: "金马奖长期以哪类影片为主要对象？",
    answer: "华语电影",
    options: ["华语电影", "北欧电影", "印度电影", "拉美电影"],
    note: "金马奖是华语电影语境里很重要的奖项。"
  },
  {
    category: "奖项与电影节",
    prompt: "“三大电影节”通常指戛纳、威尼斯和哪一个？",
    answer: "柏林",
    options: ["柏林", "多伦多", "釜山", "圣丹斯"],
    note: "欧洲三大电影节通常指戛纳、威尼斯、柏林。"
  }
];

const tvFacts: readonly TvFact[] = [
  { clue: "一位高中化学老师转向制毒犯罪", answer: "《绝命毒师》" },
  { clue: "新泽西黑帮家族与心理咨询并行展开", answer: "《黑道家族》" },
  { clue: "巴尔的摩城市系统中的警察、毒贩、港口和媒体", answer: "《火线》" },
  { clue: "广告公司、麦迪逊大道和唐·德雷柏", answer: "《广告狂人》" },
  { clue: "纽约六位朋友常在咖啡馆相聚", answer: "《老友记》" },
  { clue: "虚构纸业公司办公室里的伪纪录片喜剧", answer: "《办公室》" },
  { clue: "飞机坠落后幸存者被困神秘岛屿", answer: "《迷失》" },
  { clue: "维斯特洛诸家族争夺铁王座", answer: "《权力的游戏》" },
  { clue: "现代伦敦版夏洛克与华生破案", answer: "《神探夏洛克》" },
  { clue: "每集以科技寓言讨论现代社会焦虑", answer: "《黑镜》" },
  { clue: "英国王室与伊丽莎白二世统治时期", answer: "《王冠》" },
  { clue: "真菌末世中乔尔护送艾莉穿越美国", answer: "《最后生还者》" },
  { clue: "上世纪八十年代小镇、异世界和一群少年", answer: "《怪奇物语》" },
  { clue: "沙发、核电站和斯普林菲尔德一家人", answer: "《辛普森一家》" },
  { clue: "四位书呆子朋友与邻居佩妮", answer: "《生活大爆炸》" },
  { clue: "纽约单身专栏作家与三位好友的都市情感生活", answer: "《欲望都市》" },
  { clue: "首尔一群负债者参加致命儿童游戏", answer: "《鱿鱼游戏》" },
  { clue: "广告式超级英雄公司与反英雄小队冲突", answer: "《黑袍纠察队》" },
  { clue: "律师索尔·古德曼的前传故事", answer: "《风骚律师》" },
  { clue: "切尔诺贝利核事故的调查与善后", answer: "《切尔诺贝利》" }
];

const tvDistractors = [
  "《真探》",
  "《继承之战》",
  "《西部世界》",
  "《冰血暴》",
  "《越狱》",
  "《豪斯医生》",
  "《摩登家庭》",
  "《新闻编辑室》",
  "《纸牌屋》",
  "《双峰》",
  "《使女的故事》",
  "《曼达洛人》",
  "《毒枭》",
  "《国土安全》",
  "《后翼弃兵》",
  "《王国》"
];

function unique(values: readonly string[]) {
  return Array.from(new Set(values));
}

function hashString(value: string) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function buildOptions(answer: string, distractorPool: readonly string[], seed: string): readonly [string, string, string, string] {
  const pool = unique(distractorPool).filter((option) => option !== answer);
  const distractors: string[] = [];
  let cursor = hashString(seed) % pool.length;

  while (distractors.length < 3) {
    const candidate = pool[cursor % pool.length];

    if (candidate && !distractors.includes(candidate)) {
      distractors.push(candidate);
    }

    cursor += 5 + distractors.length * 2;
  }

  const base = [answer, ...distractors];
  const rotated = new Array<string>(4);
  const rotation = hashString(`${seed}:${answer}`) % optionLetters.length;

  base.forEach((option, index) => {
    rotated[(index + rotation) % optionLetters.length] = option;
  });

  return rotated as [string, string, string, string];
}

function makeQuestion(input: {
  id: string;
  category: string;
  prompt: string;
  answer: string;
  distractorPool: readonly string[];
  note: string;
}): WakeQuizQuestion {
  const options = buildOptions(input.answer, input.distractorPool, input.id);

  return {
    id: input.id,
    category: input.category,
    prompt: input.prompt,
    options,
    answerIndex: options.indexOf(input.answer),
    note: input.note
  };
}

function makeManualQuestion(input: ManualQuestionInput, index: number): WakeQuizQuestion {
  return {
    id: `manual-${index + 1}`,
    category: input.category,
    prompt: input.prompt,
    options: input.options,
    answerIndex: input.options.indexOf(input.answer),
    note: input.note
  };
}

const directorPool = unique([
  ...filmDirectorFacts.map((fact) => fact.director),
  ...extraDirectorDistractors
]);

const actorPool = unique([
  ...roleFacts.map((fact) => fact.actor),
  ...extraActorDistractors
]);

const tvPool = unique([
  ...tvFacts.map((fact) => fact.answer),
  ...tvDistractors
]);

const directorQuestions = filmDirectorFacts.map((fact, index) =>
  makeQuestion({
    id: `director-${index + 1}`,
    category: "导演",
    prompt: `${fact.film}的导演是谁？`,
    answer: fact.director,
    distractorPool: directorPool,
    note: `${fact.film}由${fact.director}执导。`
  })
);

const roleQuestions = roleFacts.map((fact, index) =>
  makeQuestion({
    id: `role-${index + 1}`,
    category: "角色",
    prompt: `${fact.work}里“${fact.role}”由谁饰演？`,
    answer: fact.actor,
    distractorPool: actorPool,
    note: `${fact.actor}在${fact.work}中饰演${fact.role}。`
  })
);

const regionQuestions = regionFacts.map((fact, index) =>
  makeQuestion({
    id: `region-${index + 1}`,
    category: "地区",
    prompt: `${fact.work}通常归入哪个国家或地区的影视作品？`,
    answer: fact.region,
    distractorPool: regionPool,
    note: `${fact.work}通常会被归入${fact.region}作品。`
  })
);

const oscarQuestions = oscarBestPictureWinners.map((winner, index) =>
  makeQuestion({
    id: `oscar-picture-${index + 1}`,
    category: "奥斯卡",
    prompt: "以下哪部电影曾获得奥斯卡最佳影片？",
    answer: winner,
    distractorPool: oscarBestPictureDistractors,
    note: `${winner}曾获得奥斯卡最佳影片。`
  })
);

const animationQuestions = animatedFeatureWinners.map((winner, index) =>
  makeQuestion({
    id: `oscar-animation-${index + 1}`,
    category: "动画",
    prompt: "以下哪部作品获得过奥斯卡最佳动画长片？",
    answer: winner,
    distractorPool: animatedFeatureDistractors,
    note: `${winner}获得过奥斯卡最佳动画长片。`
  })
);

const tvQuestions = tvFacts.map((fact, index) =>
  makeQuestion({
    id: `tv-${index + 1}`,
    category: "剧集",
    prompt: `哪部剧集最符合这个描述：${fact.clue}？`,
    answer: fact.answer,
    distractorPool: tvPool,
    note: `${fact.answer}的核心识别点是：${fact.clue}。`
  })
);

export const wakeQuizQuestions: readonly WakeQuizQuestion[] = [
  ...directorQuestions,
  ...roleQuestions,
  ...regionQuestions,
  ...oscarQuestions,
  ...animationQuestions,
  ...manualQuestions.map(makeManualQuestion),
  ...tvQuestions
];

export const wakeQuizQuestionCount = wakeQuizQuestions.length;

function nextRandom(seed: number) {
  return Math.imul(seed ^ (seed >>> 15), 2246822519) >>> 0;
}

export function createWakeQuizOrder(seed = Date.now()) {
  const order = wakeQuizQuestions.map((_, index) => index);
  let currentSeed = seed >>> 0;

  for (let index = order.length - 1; index > 0; index -= 1) {
    currentSeed = nextRandom(currentSeed + index);
    const swapIndex = currentSeed % (index + 1);
    [order[index], order[swapIndex]] = [order[swapIndex], order[index]];
  }

  return order;
}
