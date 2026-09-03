// 1. 定义一个包含预设标题的数组
const titles = [
  "昔日的神明留下旧日的幻想",
  "唯有永恒依旧",
  "尚若永恒不在",
  "梦中予你满天繁星的幻想",
  "我们同在的回忆",
  "花曾开过的证明",
  "愿此行，终抵群星"
];

// 2. 生成一个 0 到 数组长度-1 之间的随机整数
const randomIndex = Math.floor(Math.random() * titles.length);

// 3. 将随机选中的标题应用到网页上
document.title = titles[randomIndex];
