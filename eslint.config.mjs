import { defineConfig } from "eslint/config";
import next from "eslint-config-next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig([
  // P3-loop fix: bỏ qua output sinh tự động (Playwright trace viewer, test artifacts, build)
  // để lint chỉ quét source — trước đây trace assets từng gây 188 lỗi giả.
  // gen-build-info.cjs là script build Node (.cjs không nằm trong files mà
  // eslint-config-next đăng ký plugin react-hooks) — quét nó gây lỗi config
  // "could not find plugin react-hooks" (CI #251 đỏ), không phải lỗi code.
  // Python/ là runtime Python nhúng (không phải source JS của app) — quét vào gây lỗi parse.
  { ignores: ["playwright-report/**", "test-results/**", ".next/**", "node_modules/**", "Python/**", "scripts/gen-build-info.cjs"] },
  {
    extends: [...next],
    // TODO(P3): React Compiler bỏ qua tối ưu vài useMemo (Inventory/Suppliers) nhưng memo tay
    // vẫn chạy đúng ở runtime — chỉ là gợi ý tối ưu, không phải bug. Tạm warn để build không
    // đỏ; triage riêng khi tách nhỏ các view (kế hoạch P3). Xóa override này khi hết warn.
    rules: {
        "react-hooks/preserve-manual-memoization": "warn",
    },
  },
]);
