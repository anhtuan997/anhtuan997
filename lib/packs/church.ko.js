// Gói phòng: NHÀ THỜ / NHÀ NGUYỆN — TIẾNG HÀN (한국어 · 기도의 집)
// Tin Lành (개신교) là tôn giáo đông nhất Hàn Quốc (~18%), Công giáo ~6–11% => phòng dùng ngôn ngữ chung,
// trung tính giữa hai hệ phái: "기도의 집" (Nhà cầu nguyện), thắp nến (봉헌초), lời Kinh Thánh, chuông nhà thờ.
//
// Câu Kinh Thánh: bản dịch tiếng Hàn hiện đại do DỰ ÁN TỰ DỊCH từ nguyên bản (thuộc phạm vi công cộng).
// KHÔNG chép bản 개역개정 / 새번역 (thuộc bản quyền Hội Kinh Thánh Hàn Quốc).
//
// Ánh xạ nghi thức (giữ tên phương thức JSON-RPC cũ để dùng chung máy chủ):
//   burnIncense       => 촛불 봉헌 (thắp nến)
//   strikeWoodenFish  => 아멘 (lượt thích = "Amen")
//   ringBell          => 교회 종 (chuông nhà thờ)
//   sendPrayer        => 기도 제목 (ý cầu nguyện bay lên thành ánh sáng)
//   offerGift         => 감사 예물 (quà tặng)
//   drawFortune       => 오늘의 말씀 (câu Kinh Thánh hôm nay)
//   grandCeremony     => 할렐루야 찬양 (quà lớn: ánh sáng + hợp xướng)
'use strict';

const { josa } = require('./korean');

module.exports = {
  id: 'church.ko',
  room: 'church',
  locale: 'ko',
  meta: {
    title: '24시 기도의 집 · 라이브',
    htmlLang: 'ko',
    numberLocale: 'ko-KR',
    timeZone: 'Asia/Seoul',
    page: 'church.html'
  },
  tts: { engine: 'edge', voice: 'ko-KR-SunHiNeural', browserLang: 'ko-KR' },
  defaultName: '성도님',

  defaults: {
    incenseWish: '주님의 평안이 함께하기를 기도합니다',
    bellWish: '종소리와 함께 모든 이에게 평안이 있기를',
    prayerWish: '가족 모두 건강하고 평안하기를 기도합니다',
    topic: '평안 · 건강 · 감사',
    memberWish: '기도의 집에 들어왔습니다',
    followWish: '기도의 집에 함께해 주셔서 감사합니다',
    tiktokGiftFallbackName: '감사의 장미',
    giftWish: (gift) => `${josa(gift, '으로', '로')} 감사를 전합니다`,
    tiktokGiftWish: (gift) => `${josa(gift, '으로', '로')} 감사의 마음을 전합니다`,
    drawRecord: (card) => `오늘의 말씀: ${card.title}`
  },

  giftLabels: {
    lotus: '감사의 꽃다발',
    fruit: '축복의 바구니',
    lamp: '사랑의 촛불',
    dragon: '할렐루야 찬양'
  },
  grandName: '할렐루야 찬양',
  simGiftName: '감사의 꽃다발',

  speech: {
    incense: ({ name, count, wish }) =>
      `${name}님, 촛불 ${count}개를 밝혀 주셔서 감사합니다. ${wish}. 함께 기도하겠습니다.`,
    bell: ({ name, wish }) => `${name}님께서 종을 울리며 기도합니다. ${wish}.`,
    prayer: ({ name, wish }) => `${name}님의 기도 제목입니다. ${wish}. 주님의 평안이 함께하시기를 기도합니다. 아멘.`,
    gift: ({ name, gift }) =>
      `감사합니다! ${name}님께서 ${josa(gift, '을', '를')} 보내 주셨습니다. 하나님의 은혜와 평강이 늘 함께하시기를 축복합니다.`,
    draw: ({ name, card }) => `${name}님을 위한 오늘의 말씀입니다. ${card.ttsSummary}`,
    follow: ({ names }) => `${names}, 팔로우해 주셔서 감사합니다. 오늘도 평안한 하루 되세요.`,
    idle: ({ card }) => `잠시 함께 말씀을 묵상하겠습니다. ${card.ttsSummary}`
  },

  keywords: {
    fortune: ['오늘의 말씀', '말씀', '성경', '구절', '묵상'],
    bell: ['종소리', '종 쳐', '종을 울', '타종'],
    woodenFish: ['아멘', '할렐루야', 'amen', 'hallelujah'],
    incense: ['촛불', '봉헌', '초 켜'],
    prayer: ['기도', '중보', '주님', '하나님', '예수', '축복', '은혜', '평안', '평강', '치유', '건강', '합격',
      '감사', '사랑', '소원', '회복', 'pray', 'god', 'jesus']
  },

  // 오늘의 말씀 — bản dịch riêng của dự án (tham chiếu chương:câu để người xem tự tra bản mình dùng)
  deck: [
    {
      number: 1,
      rank: '요한복음 3:16',
      title: '하나님의 사랑',
      poem: '하나님은 세상을 이처럼 사랑하셔서\n외아들을 주셨으니\n그를 믿는 사람은 누구든지 멸망하지 않고\n영원한 생명을 얻게 하려는 것이다.',
      meaning: '나는 이미 깊이 사랑받고 있는 사람입니다. 오늘 그 사랑을 한 사람에게 나누어 보세요.',
      ttsSummary: '요한복음 3장 16절. 하나님은 세상을 이처럼 사랑하셔서 외아들을 주셨으니, 그를 믿는 사람은 누구든지 영원한 생명을 얻게 하려는 것입니다.'
    },
    {
      number: 2,
      rank: '시편 23:1-2',
      title: '나의 목자',
      poem: '주님은 나의 목자시니\n나에게 부족함이 없습니다.\n푸른 풀밭에 나를 눕히시고\n쉴 만한 물가로 나를 이끄십니다.',
      meaning: '지치고 불안한 날에도 나를 돌보시는 분이 계십니다. 오늘은 잠시 쉬어도 괜찮습니다.',
      ttsSummary: '시편 23편. 주님은 나의 목자시니 나에게 부족함이 없습니다. 푸른 풀밭에 나를 눕히시고, 쉴 만한 물가로 이끄십니다.'
    },
    {
      number: 3,
      rank: '빌립보서 4:13',
      title: '능력 주시는 분',
      poem: '나에게 힘을 주시는 분 안에서\n나는 모든 것을 해낼 수 있습니다.',
      meaning: '혼자 감당하기 어려운 일 앞에서 나를 붙드시는 힘을 기억하세요.',
      ttsSummary: '빌립보서 4장 13절. 나에게 힘을 주시는 분 안에서, 나는 모든 것을 해낼 수 있습니다.'
    },
    {
      number: 4,
      rank: '이사야 41:10',
      title: '두려워하지 말라',
      poem: '두려워하지 마라, 내가 너와 함께 있다.\n놀라지 마라, 나는 너의 하나님이다.\n내가 너를 강하게 하고 도와주며\n내 의로운 오른손으로 너를 붙들어 주겠다.',
      meaning: '두려움이 밀려올 때, 혼자가 아니라는 약속을 붙잡으세요.',
      ttsSummary: '이사야 41장 10절. 두려워하지 마라, 내가 너와 함께 있다. 내가 너를 강하게 하고, 오른손으로 붙들어 주겠다.'
    },
    {
      number: 5,
      rank: '마태복음 11:28',
      title: '쉼을 주시는 분',
      poem: '수고하고 무거운 짐을 진 사람들은\n모두 나에게로 오너라.\n내가 너희를 쉬게 하겠다.',
      meaning: '오늘 내려놓고 싶은 짐이 있다면 기도 제목으로 남겨 주세요. 함께 기도하겠습니다.',
      ttsSummary: '마태복음 11장 28절. 수고하고 무거운 짐을 진 사람들은 모두 나에게로 오너라. 내가 너희를 쉬게 하겠다.'
    },
    {
      number: 6,
      rank: '예레미야 29:11',
      title: '희망의 계획',
      poem: '너희를 향한 나의 계획은\n재앙이 아니라 평안을 주려는 것이며\n너희에게 미래와 희망을 주려는 것이다.',
      meaning: '지금 길이 보이지 않아도, 나를 위한 좋은 계획이 있음을 믿어 보세요.',
      ttsSummary: '예레미야 29장 11절. 너희를 향한 나의 계획은 재앙이 아니라 평안이며, 너희에게 미래와 희망을 주려는 것이다.'
    },
    {
      number: 7,
      rank: '잠언 3:5-6',
      title: '마음을 다하여',
      poem: '마음을 다하여 주님을 신뢰하고\n네 지식만 의지하지 마라.\n모든 길에서 주님을 인정하면\n그분이 네 길을 곧게 하실 것이다.',
      meaning: '내 계획보다 더 큰 인도하심을 신뢰할 때 마음에 평안이 찾아옵니다.',
      ttsSummary: '잠언 3장 5절과 6절. 마음을 다하여 주님을 신뢰하라. 모든 길에서 주님을 인정하면 그분이 네 길을 곧게 하실 것이다.'
    },
    {
      number: 8,
      rank: '고린도전서 13:4',
      title: '사랑은',
      poem: '사랑은 오래 참고, 사랑은 친절합니다.\n사랑은 시기하지 않으며\n뽐내지 않고 교만하지 않습니다.',
      meaning: '오늘 가장 가까운 사람에게 조금 더 오래 참고, 조금 더 친절해 보세요.',
      ttsSummary: '고린도전서 13장 4절. 사랑은 오래 참고, 사랑은 친절합니다. 사랑은 시기하지 않으며 교만하지 않습니다.'
    },
    {
      number: 9,
      rank: '로마서 8:28',
      title: '합력하여 선을 이루는',
      poem: '하나님을 사랑하는 사람들에게는\n모든 일이 함께 작용하여\n선을 이룬다는 것을 우리는 압니다.',
      meaning: '지금의 어려움도 언젠가 좋은 열매의 한 부분이 될 수 있습니다.',
      ttsSummary: '로마서 8장 28절. 하나님을 사랑하는 사람들에게는 모든 일이 함께 작용하여 선을 이룹니다.'
    },
    {
      number: 10,
      rank: '시편 46:1',
      title: '피난처',
      poem: '하나님은 우리의 피난처이시며 힘이시니\n어려운 때에 언제나 곁에 계시는\n우리의 도움이십니다.',
      meaning: '어려운 순간에도 숨을 곳, 기댈 곳이 있습니다.',
      ttsSummary: '시편 46편 1절. 하나님은 우리의 피난처이시며 힘이시니, 어려운 때에 언제나 곁에 계시는 도움이십니다.'
    },
    {
      number: 11,
      rank: '여호수아 1:9',
      title: '강하고 담대하라',
      poem: '강하고 담대하여라.\n두려워하지 말고 낙심하지 마라.\n네가 어디로 가든지\n주 너의 하나님이 너와 함께하신다.',
      meaning: '새로운 시작 앞에서 망설여질 때, 함께하신다는 약속을 기억하세요.',
      ttsSummary: '여호수아 1장 9절. 강하고 담대하여라. 두려워하지 말라. 네가 어디로 가든지 하나님이 너와 함께하신다.'
    },
    {
      number: 12,
      rank: '데살로니가전서 5:16-18',
      title: '기쁨 · 기도 · 감사',
      poem: '항상 기뻐하십시오.\n쉬지 말고 기도하십시오.\n모든 일에 감사하십시오.',
      meaning: '오늘 감사한 일 한 가지를 댓글로 나눠 주세요.',
      ttsSummary: '데살로니가전서 5장. 항상 기뻐하십시오. 쉬지 말고 기도하십시오. 모든 일에 감사하십시오.'
    },
    {
      number: 13,
      rank: '민수기 6:24-26',
      title: '축복의 기도',
      poem: '주님께서 너에게 복을 주시고 너를 지켜 주시기를.\n주님께서 너를 밝은 얼굴로 대하시고\n은혜 베푸시기를.\n주님께서 너에게 평화를 주시기를.',
      meaning: '이 축복의 말씀을 사랑하는 사람에게 그대로 전해 보세요.',
      ttsSummary: '민수기 6장. 주님께서 너에게 복을 주시고 지켜 주시기를. 은혜를 베푸시고, 너에게 평화를 주시기를 원합니다.'
    },
    {
      number: 14,
      rank: '마태복음 6:34',
      title: '내일 일은',
      poem: '그러므로 내일 일을 걱정하지 마라.\n내일 일은 내일이 걱정할 것이다.\n한 날의 괴로움은 그날로 충분하다.',
      meaning: '오늘 하루만큼의 걸음에 집중하면 마음이 한결 가벼워집니다.',
      ttsSummary: '마태복음 6장 34절. 내일 일을 걱정하지 마라. 내일 일은 내일이 걱정할 것이다.'
    }
  ],

  // Giả lập: CHỈ dùng khi thử nghiệm
  sim: [
    { user: '은혜', uniqueId: 'grace_k', wish: '어머니의 수술이 잘 끝나도록 기도 부탁드립니다' },
    { user: '김요한', uniqueId: 'john.kim', wish: '취업 준비 중입니다. 좋은 길이 열리도록 기도해 주세요' },
    { user: '이사랑', uniqueId: 'sarang_lee', wish: '가정에 평안이 가득하기를 기도합니다' },
    { user: '박다니엘', uniqueId: 'daniel.p', wish: '오늘의 말씀 부탁드립니다' },
    { user: '최소망', uniqueId: 'hope_choi', wish: '아픈 친구가 빨리 회복되기를 기도합니다' },
    { user: '정믿음', uniqueId: 'faith.j', wish: '감사합니다. 아멘' }
  ],

  idleTalks: [
    '이곳은 24시간 열려 있는 기도의 집입니다. 기도 제목을 댓글로 남겨 주시면 함께 기도하겠습니다.',
    '잠시 눈을 감고 깊이 숨을 쉬어 봅니다. 지금 이 순간에도 주님의 평안이 함께하시기를 기도합니다.',
    '댓글에 오늘의 말씀이라고 남겨 주시면 성경 말씀 한 구절을 읽어 드립니다.'
  ],

  // Lịch theo giờ Hàn Quốc (KST): 새벽기도 (cầu nguyện rạng sáng — đặc trưng của Hội thánh Hàn), cầu nguyện trưa, tối.
  // days: 0 = Chủ nhật. Dòng có days chỉ chạy vào những ngày đó.
  schedule: [
    {
      time: '05:00',
      title: '새벽기도',
      bells: 3,
      text: '새벽 기도 시간입니다. 하루의 첫 시간을 주님께 드리며 모든 분의 평안을 위해 기도합니다.'
    },
    {
      time: '12:00',
      title: '정오의 기도',
      bells: 1,
      text: '정오입니다. 바쁜 하루 가운데 잠시 멈추어 감사의 기도를 드립니다.'
    },
    {
      time: '21:00',
      title: '저녁기도',
      bells: 2,
      text: '저녁 기도 시간입니다. 오늘 하루를 지켜 주신 은혜에 감사드리며 편안한 밤을 기도합니다.'
    },
    {
      time: '11:00',
      days: [0],
      title: '주일 예배 시간',
      bells: 3,
      text: '주일 예배 시간입니다. 각자의 교회에서 예배드리는 모든 분께 은혜가 가득하기를 축복합니다.'
    }
  ],

  ui: {
    pageTitle: '24시 기도의 집 · 라이브',
    brand: '24시 기도의 집',
    brandSim: '기도의 집 • 시뮬레이션 모드',
    liveViewers: 'LIVE @{user} • {n}명 함께 기도 중',
    connecting: '@{user} 연결 중...',
    unitCandle: '촛불',
    unitAmen: '아멘',
    unitPrayer: '기도',
    meritFloat: '+{n} ♥',
    defaultName: '성도님',
    defaultWish: '주님의 평안이 함께하시기를',
    actIncense: '🕯️ 촛불 {count}개 봉헌',
    actBell: '🔔 종을 울립니다',
    actPrayer: '🙏 기도 제목',
    actGift: '💐 {gift}',
    actGrand: '✨ {gift}',
    actAmen: '🙌 아멘 ×{count}',
    verseLoading: '📖 말씀을 펼치는 중...',
    verseFor: '{user}님을 위한 오늘의 말씀',
    verseReflect: '묵상: {meaning}',
    verseNote: '※ 본 방송용으로 새로 옮긴 번역입니다',
    grandSub: '{user}님 • 감사와 찬양을 드립니다',
    cardCandleTag: '댓글 · 기도',
    cardCandle: '촛불 봉헌',
    cardAmenTag: '좋아요 · 아멘',
    cardAmen: '아멘',
    cardGiftTag: '선물 · 감사',
    cardGift: '감사 예물',
    lbHeader: '함께 기도한 분들',
    prayerWall: '기도 제목',
    scheduleBadge: '🔔 {title}',
    clockLabel: '서울',
    hint: '댓글: 기도 · 촛불 · 오늘의 말씀 · 아멘'
  }
};
