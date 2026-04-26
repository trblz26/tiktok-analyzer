# TikTok Profile Analyzer — Chrome Extension

Phân tích video TikTok profile trong 7 ngày gần nhất: thống kê theo ngày, giờ đăng, lượt xem và tương tác.

---

## Cài đặt

### Bước 1: Tạo icon (bắt buộc)
Tạo folder `icons/` bên trong thư mục extension và thêm 3 file icon PNG:
- `icons/icon16.png` — 16×16 px
- `icons/icon48.png` — 48×48 px  
- `icons/icon128.png` — 128×128 px

> **Tip:** Bạn có thể dùng bất kỳ ảnh PNG nào, đổi tên lại là được. Hoặc dùng [favicon.io](https://favicon.io) để tạo icon nhanh.

### Bước 2: Load extension vào Chrome
1. Mở Chrome → Địa chỉ: `chrome://extensions/`
2. Bật **Developer mode** (góc trên phải)
3. Nhấn **Load unpacked**
4. Chọn thư mục chứa extension này (`tiktok-analyzer/`)

### Bước 3: Sử dụng
1. Mở trang profile TikTok, ví dụ: `https://www.tiktok.com/@ladiesfashion106`
2. Đợi trang load xong (có thể thấy video hiện ra)
3. Nhấn icon extension trên thanh toolbar
4. Nhấn **▶ Phân tích**
5. Đợi 10-20 giây để crawl xong

---

## Tính năng

### 📊 Thống kê tổng quan
- Tổng số video trong 7 ngày
- Tổng lượt xem, yêu thích, bình luận

### 🕐 Heatmap giờ đăng
- Biểu đồ 24 ô hiển thị các giờ trong ngày
- Màu càng đậm = đăng nhiều video trong giờ đó

### 📅 Chi tiết từng ngày
Mỗi ngày hiển thị:
- Số video đăng trong ngày
- Tổng view, like của ngày đó
- Từng video: **giờ:phút đăng**, mô tả, view/like/comment/share/save

### 💾 Xuất dữ liệu
- **CSV** — mở được bằng Excel (có BOM UTF-8, đọc được tiếng Việt)
- **JSON** — dùng cho lập trình viên

---

## Cách hoạt động

Extension sử dụng 3 phương pháp crawl theo thứ tự ưu tiên:

1. **`__NEXT_DATA__`** — Đọc dữ liệu từ thẻ script Next.js (nhanh nhất, không cần scroll)
2. **`SIGI_STATE`** — Đọc từ global state của TikTok (phương án dự phòng)
3. **DOM Crawl** — Scroll trang và đọc từ HTML elements (chậm nhất, dùng khi 2 cách trên không có)

TikTok video ID chứa Unix timestamp trong 32 bit đầu, nên có thể decode thời gian đăng ngay cả khi không có `createTime` field.

---

## Lưu ý
- Extension **không gửi dữ liệu ra ngoài**, mọi xử lý đều local
- TikTok thay đổi cấu trúc HTML thường xuyên, nếu không lấy được stats (view, like) thì chỉ hiện giờ đăng
- Profile private sẽ không crawl được video
- Dữ liệu được cache tạm trong `chrome.storage.local`, reload popup vẫn thấy kết quả cũ

---

## Cấu trúc file
```
tiktok-analyzer/
├── manifest.json     # Cấu hình extension
├── popup.html        # Giao diện popup
├── popup.js          # Logic render và export
├── content.js        # Crawl dữ liệu từ trang TikTok
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```
