# Bằng chứng render isolation

Được kiểm bằng Vitest trong `src/App.test.tsx`, test `keeps the 88 memoized keys isolated when one key is held and released`.

- Test render toàn bộ 88 phím trong `React.StrictMode` và bọc từng phím memoized bằng `React.Profiler`.
- Callback bỏ qua phase `mount`; baseline được chụp sau khi DOM có đủ 88 phím, vì vậy StrictMode mount không bị tính là update.
- Khi nhấn C4: Profiler ghi đúng 1 commit update cho `piano-key-60`; 87 ID còn lại giữ nguyên baseline.
- Khi thả C4: C4 nhận thêm đúng 1 commit update (tổng 2); 87 phím khác vẫn không tăng.
- Test không tăng state và không đếm bằng effect phụ thuộc vào `isPressed`/`note`.

Kết quả regression cuối: `npm run verify` — 22/22 test pass.
