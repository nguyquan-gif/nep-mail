# Tự vận hành Nếp Mail

Phần mềm không yêu cầu dịch vụ gửi email trả phí hay API key bên ngoài. SMTP do bạn vận hành chịu trách nhiệm giao thư. Postfix tra MX và giao trực tiếp khi `relayhost` trống. Không có cam kết 0 đồng cho tên miền, điện, Internet, máy chủ hoặc IP.

## 1. Chạy thử trên Windows / Docker Desktop

Yêu cầu Docker Desktop đang chạy Linux containers. Giải nén mã nguồn và mở PowerShell tại thư mục dự án:

```powershell
.\Start-NepMail.ps1
```

Script tạo `.env` bằng khóa ngẫu nhiên độc lập nếu chưa tồn tại; không ghi đè cấu hình cũ. Nếu chính sách máy chặn script, đọc script trước và chạy thủ công các lệnh tương đương theo chính sách máy. Không cần thay đổi chính sách bảo mật toàn máy.

- Ứng dụng: http://localhost:3000
- Hộp thư thử Mailpit: http://localhost:8025
- Mật khẩu quản trị: giá trị `ADMIN_PASSWORD` trong `.env` trên máy của bạn; không gửi lên chat hoặc Git.
- Tạo workspace, thêm dữ liệu mẫu, chọn mẫu email, lưu chiến dịch, bấm **Gửi vào hộp thư thử**. Mở Mailpit để xem MIME/HTML/text.
- `compose.yaml` ép `LIVE_SEND=false`, chỉ kết nối Mailpit. Xếp hàng không gửi ra Internet trong chế độ này.
- Dữ liệu app và Mailpit nằm trên Docker named volumes. `docker compose down` giữ dữ liệu. Không dùng `down -v` nếu muốn giữ dữ liệu.

Chạy native với Node 24.19 trở lên:

```sh
corepack enable
pnpm install --frozen-lockfile
node scripts/setup.mjs
pnpm build:selfhost
# Cấu hình SMTP_HOST/SMTP_PORT cho hộp thư thử do bạn vận hành.
pnpm start:selfhost
```

## 2. Gửi trực tiếp ra Internet

Đây là cổng triển khai chưa được nghiệm thu trong môi trường phát triển này. Máy/VPS phải cho phép kết nối TCP 25 ra máy chủ MX của người nhận. Docker trên Windows không tự giải quyết được IP động, NAT, ISP chặn cổng hoặc reverse DNS.

Chuẩn bị:

1. Máy chủ Linux chạy liên tục, public IP phù hợp để gửi mail và outbound TCP 25 hoạt động.
2. Tên miền; A record của `mail.domain.vn` đến IP gửi. PTR của IP trỏ lại hostname này và forward DNS khớp. PTR thường do bên quản lý IP cấu hình.
3. SPF cho đúng IP gửi, không mở rộng sang IP không dùng; DKIM selector `nep` với public key tương ứng; DMARC với chính sách triển khai theo từng giai đoạn. Theo dõi kết quả xác thực thực tế trước khi tăng lượng gửi.
4. HTTPS reverse proxy cho app; URL hủy nhận phải truy cập được khi không đăng nhập. Không đặt toàn bộ origin sau một cổng đăng nhập của proxy vì sẽ chặn hủy nhận.
5. Địa chỉ `MAIL_FROM` nhận được phản hồi/bounce ở một mailbox bạn kiểm soát. Bản alpha chưa tự thu nhận hoặc phân loại bounce từ Internet.
6. Private key DKIM đọc được bởi UID 1000 trong container app, không nằm trong Git; chỉ mount read-only. Xác minh DMARC alignment giữa From, DKIM d= và domain thực tế.

Ví dụ `.env` sau khi đã hoàn thành các bước trên:

```dotenv
APP_ORIGIN=https://mail.domain.vn
PUBLIC_UNSUBSCRIBE_ORIGIN=https://mail.domain.vn
MAIL_FROM=news@domain.vn
MAIL_DOMAIN=domain.vn
MAIL_HOSTNAME=mail.domain.vn
DKIM_SELECTOR=nep
CAPTURE_MODE=false
LIVE_SEND=false
```

Tạo `dkim.key` (RSA 2048) trên máy quản trị, xuất public key để cấu hình DNS. Không dùng key thử của người khác. Thêm private key vào `.gitignore` nếu đổi tên.

```sh
openssl genrsa -out dkim.key 2048
openssl rsa -in dkim.key -pubout
# Linux: cho UID 1000 đọc, không công khai key; điều chỉnh theo chính sách máy.
docker compose -f compose.direct.yaml config --quiet
docker compose -f compose.direct.yaml up -d --build
```

`compose.direct.yaml` là cấu hình riêng, không phải override của compose mặc định. Sau khi kiểm chứng DNS, URL hủy nhận và thử địa chỉ thuộc quyền kiểm soát, đổi `LIVE_SEND=true` rồi recreate app. Không có API key nhà cung cấp nào.

Postfix chỉ cho IP app `172.30.55.10/32` relay. Không publish cổng SMTP ra host. Nếu subnet trùng hạ tầng, đổi nhất quán cả compose và `mynetworks`. Giữ các container không tin cậy ra khỏi network này. Log và queue SMTP:

```sh
docker compose -f compose.direct.yaml logs -f postfix
docker compose -f compose.direct.yaml exec postfix postqueue -p
```

Scheduler trong app xét tối đa 3 chiến dịch mỗi 10 giây, mỗi chiến dịch tối đa 10 thư. Đây là worker alpha một máy; SQLite/shared volume không phải mô hình cluster nhiều host. Dừng app sẽ dừng lịch xử lý; Postfix vẫn có thể giao các thư nó đã nhận. Hủy chiến dịch không thu hồi được thư đã vào queue Postfix.

## 3. Backup và phục hồi

Backup SQLite phải nhất quán, không chỉ copy `.sqlite` khi WAL đang hoạt động. Native dùng `node scripts/backup.mjs /path/to/backup.sqlite`. Với Docker, dừng app trước khi snapshot volume, hoặc chạy công cụ SQLite backup trong container. Bảo vệ cả database, `.env`, DKIM key và queue Postfix theo chính sách lưu trữ riêng; không đưa chúng vào repo.

Khôi phục trên môi trường cách ly trước: dừng app, khôi phục database và quyền UID 1000, kiểm tra `PRAGMA integrity_check`, đếm workspace/contact/campaign, khởi động với `LIVE_SEND=false`. Không bật gửi cho đến khi đối soát các bản ghi `submitting/unknown` và queue SMTP. Chưa có restore drill trên Docker trong bản bàn giao này.

## 4. Giới hạn cần hiểu

- SMTP đã tiếp nhận không đồng nghĩa delivered hoặc vào inbox. Báo cáo không suy diễn opens/clicks.
- Timeout sau khi SMTP nhận thư có thể tạo kết quả không xác định. Nếp Mail giữ `unknown`, không tự gửi lại. Crash trong lúc gửi cũng cần đối soát; Message-ID không phải bảo đảm exactly-once.
- Không xóa/chặn được thư đã được Postfix nhận. Suppression được kiểm tra ngay trước khi giao SMTP, nhưng vẫn tồn tại một khoảng race nhỏ giữa kiểm tra và tác động bên ngoài.
- Self-host alpha có một admin bootstrap. Phân quyền core đã có, nhưng chưa có signup, password reset, OIDC/LDAP hay nhiều tài khoản native.
- SQLite phù hợp pilot một máy. Chưa tối ưu số lượng lớn; hàng đợi alpha giới hạn 500 liên hệ/workspace.
- Máy chủ mail công khai cần thêm vận hành chống lạm dụng, quản lý uy tín IP, bounce/complaint, theo dõi queue và cập nhật phần mềm.

Nguồn kỹ thuật: https://www.postfix.org/BASIC_CONFIGURATION_README.html và https://www.postfix.org/TLS_README.html.
