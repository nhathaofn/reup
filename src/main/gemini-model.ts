/**
 * Model Gemini dùng cho các request của T-blao.
 *
 * Không tự động dò hoặc chuyển sang model khác: khi model này không khả dụng,
 * request phải báo lỗi rõ ràng để kết quả không bị thay đổi ngoài ý muốn.
 */
export const LOCKED_GEMINI_MODEL = 'gemini-3.5-flash-lite'
