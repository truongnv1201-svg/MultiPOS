import { defineConfig } from "eslint/config";
import next from "eslint-config-next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig([{
    extends: [...next],
    // TODO(P3): React Compiler bỏ qua tối ưu vài useMemo (Inventory/Suppliers) nhưng memo tay
    // vẫn chạy đúng ở runtime — chỉ là gợi ý tối ưu, không phải bug. Tạm warn để build không
    // đỏ; triage riêng khi tách nhỏ các view (kế hoạch P3). Xóa override này khi hết warn.
    rules: {
        "react-hooks/preserve-manual-memoization": "warn",
    },
}]);
