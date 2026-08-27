import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import importPlugin from "eslint-plugin-import";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  // 产品线边界（见 docs/产品线归属清单.md §4）
  // 仅冻结 src/lib 层：③ 短剧工坊(drama) ↔ ② 小说改编(pipeline/novel/jobs/result/eval) 互不引用。
  {
    files: ["src/lib/**/*.{ts,tsx}"],
    plugins: { import: importPlugin },
    settings: {
      "import/parsers": { "@typescript-eslint/parser": [".ts", ".tsx"] },
    },
    rules: {
      "import/no-restricted-paths": [
        "error",
        {
          zones: [
            // ② 不得引用 ③（短剧工坊底层不得被改编流程反向依赖）
            {
              target: [
                "./src/lib/pipeline/**",
                "./src/lib/novel/**",
                "./src/lib/jobs/**",
                "./src/lib/result/**",
                "./src/lib/eval/**",
              ],
              from: "./src/lib/drama/**",
            },
            // ③ 不得引用 ②（短剧工坊不得直接触碰改编管线/小说解析）
            {
              target: ["./src/lib/drama/**"],
              from: [
                "./src/lib/pipeline/**",
                "./src/lib/novel/**",
                "./src/lib/jobs/**",
                "./src/lib/result/**",
                "./src/lib/eval/**",
              ],
            },
          ],
        },
      ],
    },
  },

  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
