// Gói phòng: CHÙA — TIẾNG VIỆT (giữ nguyên câu chữ của bản gốc)
'use strict';

module.exports = {
  id: 'temple.vi',
  room: 'temple',
  locale: 'vi',
  meta: {
    title: 'Chùa Linh Ứng Online — TikTok Live',
    htmlLang: 'vi',
    numberLocale: 'vi-VN',
    timeZone: 'Asia/Ho_Chi_Minh',
    page: 'index.html'
  },
  tts: { engine: 'zerotts', voice: 'maichi', browserLang: 'vi-VN' },
  defaultName: 'Thí Chủ Hữu Duyên',

  defaults: {
    incenseWish: 'Thành tâm dâng hương bái Phật, cầu bình an cát tường',
    bellWish: 'Thỉnh chuông Bát Nhã, phiền não tiêu tan, trí tuệ sáng ngời',
    prayerWish: 'Cầu cho quốc thái dân an, gia đình mạnh khỏe hạnh phúc',
    topic: 'Gia đạo, Tài lộc và Bình an',
    memberWish: 'Đã vào Chánh Điện lễ Phật',
    followWish: 'Hữu duyên tương ngộ nơi cửa Phật, cầu bình an may mắn',
    tiktokGiftFallbackName: 'Hoa Hồng Tâm Thành',
    giftWish: (gift) => `Dâng cúng ${gift} lên Tam Bảo`,
    tiktokGiftWish: (gift) => `Thành tâm dâng ${gift} kính lễ Đức Phật A Di Đà`,
    drawRecord: (card) => `Xin xăm: Quẻ số ${card.number} (${card.rank})`
  },

  giftLabels: {
    lotus: 'Đài Hoa Sen Vàng',
    fruit: 'Mâm Ngũ Quả Cát Tường',
    lamp: 'Đèn Lưu Ly Trí Tuệ',
    dragon: 'Đại Lễ Kim Long Chầu Phật'
  },
  grandName: 'Đại Lễ Hào Quang Vạn Trượng',
  simGiftName: 'Hoa Sen Vàng Tinh Khiết',

  speech: {
    incense: ({ name, count, wish }) =>
      `Nam mô A Di Đà Phật. Cảm tạ thí chủ ${name} đã thành tâm thắp ${count} nén hương thơm. ${wish}.`,
    bell: ({ name, wish }) => `Thí chủ ${name} thỉnh Đại Hồng Chung cầu nguyện: ${wish}.`,
    prayer: ({ name, wish }) => `Lời cầu nguyện của thí chủ ${name}: ${wish}. Nam mô A Di Đà Phật.`,
    gift: ({ name, gift, merit }) =>
      `Công đức vô lượng! Cảm tạ thí chủ ${name} đã phát tâm dâng cúng ${gift}, tích thêm ${merit} điểm công đức. Nguyện cầu chư Phật gia hộ cho thí chủ vạn sự cát tường như ý.`,
    draw: ({ name, card }) => `Thí chủ ${name} vừa gieo được ${card.ttsSummary}`,
    follow: null, // bản tiếng Việt gốc không đọc lời chào khi theo dõi
    idle: null
  },

  // Từ khoá trong bình luận => nghi thức (so khớp chữ thường, chứa chuỗi con)
  keywords: {
    fortune: ['xin xăm', 'xin xam', 'gieo quẻ', 'gieo que', 'rút quẻ', 'rut que', 'quẻ', 'que'],
    bell: ['chuông', 'chuong', 'thỉnh chuông'],
    woodenFish: ['gõ mõ', 'go mo', 'tụng kinh'],
    incense: ['thắp hương', 'thap huong', 'dâng hương', 'dang huong', 'bái phật', 'bai phat', 'lạy phật', 'lay phat'],
    prayer: ['cầu', 'cau ', 'nguyện', 'nguyen', 'nam mô', 'nam mo', 'mô phật', 'mo phat', 'a di đà', 'a di da',
      'bình an', 'tài lộc', 'chúc']
  },

  deck: [
    {
      number: 1,
      rank: 'Thượng Thượng Cát',
      title: 'Nhật Xuất Đông Phương — Mặt Trời Mọc Phương Đông',
      poem: 'Đông phương nhật xuất chiếu Càn Khôn\nHoa nở đầy cành rạng sắc xuân\nCông danh tài lộc đều viên mãn\nGia đạo bình an phúc lộc tồn.',
      meaning: 'Mọi sự mưu cầu đều đại cát đại lợi. Công việc hanh thông, quý nhân phù trợ, gia đình hòa thuận ấm êm.',
      ttsSummary: 'Quẻ số 1, Thượng Thượng Cát, Nhật Xuất Đông Phương. Mọi sự mưu cầu đều đại cát đại lợi, công danh tài lộc viên mãn, quý nhân phù trợ.'
    },
    {
      number: 8,
      rank: 'Thượng Cát',
      title: 'Kim Liên Khai Nở — Sen Vàng Tỏa Ngát',
      poem: 'Sen vàng nở rộ giữa hồ trong\nHương thơm lan tỏa khắp non sông\nLòng thành thắp nén nhang cầu nguyện\nTrời Phật chứng tri thỏa ước mong.',
      meaning: 'Tâm thiện lành ắt gặp phước báu. Cầu tài đắc tài, cầu bình an đắc bình an, bệnh tật tiêu trừ.',
      ttsSummary: 'Quẻ số 8, Thượng Cát, Kim Liên Khai Nở. Tâm thiện lành ắt gặp phước báu, cầu tài đắc tài, cầu bình an đắc bình an.'
    },
    {
      number: 12,
      rank: 'Đại Cát',
      title: 'Long Vân Tương Hội — Rồng Mây Gặp Gỡ',
      poem: 'Rồng thiêng gặp hội tầng mây xanh\nVượt Vũ Môn Quan rạng rỡ danh\nThí chủ kiên tâm hành thiện đạo\nPhúc dày lộc vượng khắp gia đình.',
      meaning: 'Thời vận đang lên mạnh mẽ. Thi cử đỗ đạt, kinh doanh phát đạt, gặp cơ hội lớn đổi đời.',
      ttsSummary: 'Quẻ số 12, Đại Cát, Long Vân Tương Hội. Thời vận đang lên mạnh mẽ, thi cử đỗ đạt, kinh doanh phát đạt.'
    },
    {
      number: 18,
      rank: 'Thượng Cát',
      title: 'Xuân Phong Đắc Ý — Gió Xuân Thuận Buồm',
      poem: 'Thuận buồm xuôi gió vượt trùng khơi\nBến giác bình yên nắng rạng ngời\nTài lộc dồi dào nhân duyên tốt\nBốn mùa hưng thịnh rộn niềm vui.',
      meaning: 'Đi xa gặp may, buôn bán thuận lợi, tình duyên êm đẹp, người thân mạnh khỏe.',
      ttsSummary: 'Quẻ số 18, Thượng Cát, Xuân Phong Đắc Ý. Thuận buồm xuôi gió, tài lộc dồi dào, nhân duyên tốt đẹp.'
    },
    {
      number: 24,
      rank: 'Trung Cát',
      title: 'Vũ Quá Thiên Thanh — Mưa Tạnh Trời Trong',
      poem: 'Mưa qua trời lại sáng trong ngần\nGian khó lùi xa đón phúc phần\nGiữ vững lòng thành đừng nản chí\nHoa thơm trái ngọt đến mười phân.',
      meaning: 'Khó khăn cũ sắp qua đi, vận may mới đang tới. Hãy kiên nhẫn và giữ tâm bình tĩnh.',
      ttsSummary: 'Quẻ số 24, Trung Cát, Vũ Quá Thiên Thanh. Mưa qua trời lại sáng trong, gian khó lùi xa để đón phúc phần mới.'
    },
    {
      number: 36,
      rank: 'Thượng Thượng Cát',
      title: 'Phúc Tinh Cao Chiếu — Sao Phúc Chiếu Mệnh',
      poem: 'Phúc tinh rực sáng giữa đêm rằm\nTừ bi Phật độ suốt quanh năm\nTài lộc tự nhiên về gõ cửa\nTrăm điều như ý vạn điều lành.',
      meaning: 'Sao Phúc chiếu mạng, tai qua nạn khỏi, tiền tài sung túc, gia đạo hưng long.',
      ttsSummary: 'Quẻ số 36, Thượng Thượng Cát, Phúc Tinh Cao Chiếu. Sao Phúc chiếu mạng, tài lộc tự nhiên gõ cửa, trăm điều như ý.'
    },
    {
      number: 52,
      rank: 'Thượng Cát',
      title: 'Ngọc Xuất Côn Sơn — Ngọc Quý Phát Sáng',
      poem: 'Ngọc quý Côn Sơn tỏa ánh ngời\nBấy lâu rèn giũa nay gặp thời\nTri âm tương ngộ cùng nâng đỡ\nSự nghiệp thăng hoa rạng rỡ đời.',
      meaning: 'Nỗ lực bấy lâu nay sắp được đền đáp xứng đáng. Có người tốt nâng đỡ trong công việc và cuộc sống.',
      ttsSummary: 'Quẻ số 52, Thượng Cát, Ngọc Xuất Côn Sơn. Nỗ lực bấy lâu sắp được đền đáp xứng đáng, sự nghiệp thăng hoa.'
    },
    {
      number: 68,
      rank: 'Đại Cát',
      title: 'Lộc Mã Đồng Hương — Lộc Tài Cùng Tới',
      poem: 'Lộc Mã song hành đến tận nhà\nLàm ăn buôn bán nở như hoa\nTâm thành bố thí thêm công đức\nPhú quý vinh hoa khắp một nhà.',
      meaning: 'Quẻ đại lợi về tài lộc và kinh doanh. Nên làm nhiều việc thiện để phúc đức càng thêm bền vững.',
      ttsSummary: 'Quẻ số 68, Đại Cát, Lộc Mã Đồng Hương. Đại lợi về tài lộc và buôn bán, phú quý vinh hoa khắp một nhà.'
    },
    {
      number: 81,
      rank: 'Thượng Cát',
      title: 'Nguyệt Nhập Trung Thiên — Trăng Rằm Giữa Đỉnh',
      poem: 'Trăng tròn vằng vặc giữa trời thu\nSoi sáng muôn phương sạch mây mù\nTình duyên viên mãn gia đình thuận\nTâm an vạn sự chẳng ưu tư.',
      meaning: 'Tình duyên và gia đạo vô cùng tốt đẹp. Người độc thân dễ gặp ý trung nhân, gia đình thêm tin vui.',
      ttsSummary: 'Quẻ số 81, Thượng Cát, Nguyệt Nhập Trung Thiên. Tình duyên viên mãn, gia đình hòa thuận, tâm an vạn sự lành.'
    },
    {
      number: 99,
      rank: 'Thượng Thượng Cát',
      title: 'Vạn Sự Viên Thành — Cửu Cửu Đại Cát',
      poem: 'Chín tầng mây trắng ánh hào quang\nTừ bi Phật Tổ độ nhân gian\nThí chủ lòng thành dâng lễ bái\nTrọn đời trường thọ hưởng vinh khang.',
      meaning: 'Quẻ tối thượng cát tường. Sức khỏe trường thọ, công danh hiển đạt, vạn sự viên thành.',
      ttsSummary: 'Quẻ số 99, Thượng Thượng Cát, Vạn Sự Viên Thành. Quẻ tối thượng cát tường, sức khỏe trường thọ, vạn sự như ý.'
    }
  ],

  sim: [
    { user: 'Ngọc Anh Nguyễn', uniqueId: 'ngocanh.98', wish: 'Con thành tâm cầu cho bố mẹ luôn mạnh khỏe, bình an' },
    { user: 'Trần Minh Quân', uniqueId: 'minhquan_bds', wish: 'Cầu tháng mới công việc thuận buồm xuôi gió, tài lộc hanh thông' },
    { user: 'Diệu Thảo Tâm An', uniqueId: 'tam_an_99', wish: 'Nam Mô A Di Đà Phật, nguyện cầu thế giới hòa bình chúng sinh an lạc' },
    { user: 'Lê Hoàng Nam', uniqueId: 'hoangnam.dev', wish: 'Cầu thi cử đỗ đạt điểm cao, sự nghiệp rộng mở' },
    { user: 'Phạm Thanh Hà', uniqueId: 'thanhha.lotus', wish: 'Cầu gia đạo êm ấm, con cái ngoan ngoãn học giỏi' },
    { user: 'Vũ Đức Thịnh', uniqueId: 'ducthinh88', wish: 'Con xin gieo một quẻ cầu tài lộc đầu năm' }
  ],

  idleTalks: [],
  schedule: [],

  // Câu chữ hiện trên màn hình người xem (trình duyệt). Bỏ trống => dùng mặc định tiếng Việt trong live.js
  ui: {}
};
