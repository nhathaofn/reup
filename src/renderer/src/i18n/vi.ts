export const vi = {
  'boot.server': 'Đang kết nối với TediaPros server…',
  'boot.dependencies': 'Đang kiểm tra môi trường xử lý media…',
  'server.eyebrow': 'Kết nối bắt buộc',
  'server.title': 'Kết nối TediaPros server',
  'server.description':
    'Ứng dụng cần xác thực server trước khi mở các công cụ. Server giữ logic xử lý và điều phối tác vụ; video, ảnh gốc vẫn ở trên máy này.',
  'server.endpointLabel': 'Địa chỉ server',
  'server.endpointPlaceholder': 'http://192.168.1.20:48191',
  'server.endpointHint':
    'Có thể dùng HTTP với địa chỉ local hoặc IP riêng trong LAN. Máy chủ công khai phải dùng HTTPS.',
  'server.managedHint':
    'Địa chỉ này do cấu hình TEDIAPROS_SERVER_URL quản lý và không thể thay đổi trong ứng dụng.',
  'server.connect': 'Kết nối',
  'server.retry': 'Thử kết nối lại',
  'server.connecting': 'Đang kết nối…',
  'server.securityTitle': 'Dữ liệu media vẫn được xử lý tại máy',
  'server.securityDescription':
    'Client chỉ gửi yêu cầu và dữ liệu tối thiểu theo từng tác vụ. Việc render media dùng runtime và GPU trên máy Windows này.',
  'server.error.invalid-url':
    'Địa chỉ server không hợp lệ. Hãy dùng IP local/LAN qua HTTP hoặc hostname HTTPS.',
  'server.error.unreachable':
    'Không thể kết nối server. Hãy kiểm tra server đang chạy và máy này đang ở đúng mạng LAN.',
  'server.error.incompatible':
    'Server đã phản hồi nhưng không tương thích với phiên bản TediaPros này.',
  'server.error.invalid-response': 'Phản hồi từ server không đúng định dạng yêu cầu.',
  'server.error.storage-error':
    'Đã kết nối server nhưng không thể lưu địa chỉ. Hãy kiểm tra quyền ghi thư mục dữ liệu ứng dụng.'
} as const
