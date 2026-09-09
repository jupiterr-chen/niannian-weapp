// 冒烟脚本共用引导：在任何会读 process.env 的模块被 import 之前，把
// .env.local / .env 加载进 process.env。
//
// 为什么需要这个文件：`npx tsx scripts/xxx.ts` 是普通 Node 进程，不是
// Next.js —— 自动加载 .env.local 是 Next.js CLI 自己做的事，tsx/node 不会
// 帮你做。不加这一步，process.env 里只有真正 export 到 shell 的变量，
// lib/env.ts 看到关键密钥是空字符串就会按设计悄悄降级成 mock provider——
// 而且不报错。后果是「本项目唯一能验证真实火山/方舟接口的脚本」永远只能
// 验证 mock，用户在 .env.local 里配的真实密钥形同虚设。
//
// 用法上必须注意 ESM 的静态 import 会被提升到模块顶部，在其他任何代码之前
// 执行——所以不能指望「把 loadDotEnv() 的调用写在文件前面」就够了，调用方
// 必须把所有会触达 lib/env.ts 的 import 都换成 `await import(...)` 动态引入，
// 并且确保这个动态 import 发生在 loadDotEnv() 之后。静态 import 在模块求值
// 阶段就已经执行完了，那时候 loadDotEnv() 还没机会跑。
//
// 用 Node 24 内置的 process.loadEnvFile()，不引入 dotenv 之类的额外依赖。
export function loadDotEnv(): void {
  const candidates = [".env.local", ".env"];
  for (const file of candidates) {
    try {
      process.loadEnvFile(file);
      return; // 找到一个就够了，不再尝试后面的候选
    } catch {
      // 文件不存在 / 读取失败：尝试下一个候选。全部失败就维持 process.env
      // 现状——lib/env.ts 自己的降级到 mock 逻辑会接管，脚本仍然能跑通。
    }
  }
}
