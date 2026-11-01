// Gói phòng: CHÙA — TIẾNG HÀN (한국어 · 사찰)
// - Lời đọc dùng kính ngữ "~님" và lối nói của Phật giáo Hàn Quốc (나무아미타불, 공덕, 발원, 연등).
// - "Xin xăm" kiểu Trung Hoa không phổ biến ở chùa Hàn => thay bằng "오늘의 부처님 말씀"
//   (Lời Phật dạy hôm nay) trích Kinh Pháp Cú (법구경). Bản dịch tiếng Hàn do dự án TỰ DỊCH
//   từ nguyên bản Pāli cổ (đã thuộc phạm vi công cộng), không chép bản dịch có bản quyền nào.
'use strict';

const { josa } = require('./korean');

module.exports = {
  id: 'temple.ko',
  room: 'temple',
  locale: 'ko',
  meta: {
    title: '온라인 법당 · 아미타불 라이브',
    htmlLang: 'ko',
    numberLocale: 'ko-KR',
    timeZone: 'Asia/Seoul',
    page: 'index.html'
  },
  tts: { engine: 'edge', voice: 'ko-KR-SunHiNeural', browserLang: 'ko-KR' },
  defaultName: '불자님',

  defaults: {
    incenseWish: '부처님께 정성껏 향을 올리며 평안을 기원합니다',
    bellWish: '범종 소리에 번뇌가 사라지고 지혜가 밝아지기를',
    prayerWish: '가족 모두 건강하고 행복하기를 발원합니다',
    topic: '건강 · 평안 · 행복',
    memberWish: '법당에 들어와 합장했습니다',
    followWish: '부처님 법당에서 좋은 인연을 맺었습니다',
    tiktokGiftFallbackName: '정성의 장미',
    giftWish: (gift) => `${gift} 공양을 올립니다`,
    tiktokGiftWish: (gift) => `${josa(gift, '을', '를')} 정성껏 공양 올립니다`,
    drawRecord: (card) => `오늘의 말씀: ${card.title}`
  },

  giftLabels: {
    lotus: '황금 연꽃 공양',
    fruit: '오색 과일 공양',
    lamp: '지혜의 연등',
    dragon: '금룡 대법회'
  },
  grandName: '만등 대법회',
  simGiftName: '황금 연꽃',

  speech: {
    incense: ({ name, count, wish }) =>
      `나무아미타불. ${name}님, 향 ${count}개를 정성껏 올려 주셔서 감사합니다. ${wish}.`,
    bell: ({ name, wish }) => `${name}님께서 범종을 울려 발원합니다. ${wish}.`,
    prayer: ({ name, wish }) => `${name}님의 발원입니다. ${wish}. 나무아미타불.`,
    gift: ({ name, gift }) =>
      `공덕이 한량없습니다! ${name}님께서 ${josa(gift, '을', '를')} 올려 주셨습니다. 부처님의 자비가 늘 함께하시기를 기원합니다.`,
    draw: ({ name, card }) => `${name}님을 위한 오늘의 부처님 말씀입니다. ${card.ttsSummary}`,
    follow: ({ names }) => `${names}, 팔로우해 주셔서 감사합니다. 오늘도 평안한 하루 보내세요.`,
    idle: ({ card }) => `잠시 마음을 고요히 하고 부처님 말씀을 들어 봅니다. ${card.ttsSummary}`
  },

  // Bình luận tiếng Hàn => nghi thức. Tránh từ quá ngắn dễ khớp nhầm (vd. "종" nằm trong "종일", "향" trong "방향").
  keywords: {
    fortune: ['오늘의 말씀', '말씀', '법문', '부처님 말씀', '운세', 'xin xăm'],
    bell: ['범종', '타종', '종소리', '종 쳐', '종을 울', 'chuông'],
    woodenFish: ['목탁', '염불', '독경', 'gõ mõ'],
    incense: ['향 올', '향을 올', '분향', '헌향', '삼배', '절 올', '참배', '합장'],
    prayer: ['기도', '발원', '소원', '기원', '나무아미타불', '아미타불', '관세음', '관세음보살', '성불', '건강',
      '합격', '행복', '평안', '평화', '감사', '사랑', '부처님']
  },

  // 오늘의 부처님 말씀 — Kinh Pháp Cú (법구경), bản dịch riêng của dự án
  deck: [
    {
      number: 2,
      rank: '법구경 제2게',
      title: '마음이 모든 것의 근본',
      poem: '모든 일은 마음이 앞서 가고\n마음이 주인 되어 마음으로 이루어진다.\n맑은 마음으로 말하고 행하면\n그림자가 몸을 따르듯 행복이 따르리라.',
      meaning: '오늘 하루, 말 한마디와 생각 하나를 맑게 지키면 기쁨은 저절로 찾아옵니다.',
      ttsSummary: '법구경 제2게. 맑은 마음으로 말하고 행하면, 그림자가 몸을 따르듯 행복이 따르리라.'
    },
    {
      number: 5,
      rank: '법구경 제5게',
      title: '원한을 내려놓는 지혜',
      poem: '원한은 원한으로 결코 풀리지 않는다.\n원한을 내려놓을 때 비로소 풀리나니\n이것은 변하지 않는 영원한 진리이다.',
      meaning: '미움을 내려놓는 것은 상대가 아니라 나 자신을 자유롭게 하는 일입니다.',
      ttsSummary: '법구경 제5게. 원한은 원한으로 풀리지 않고, 원한을 내려놓을 때 비로소 풀립니다.'
    },
    {
      number: 54,
      rank: '법구경 제54게',
      title: '덕의 향기',
      poem: '꽃향기는 바람을 거슬러 가지 못하지만\n착한 사람의 향기는 바람을 거슬러\n온 세상 사방으로 퍼져 나간다.',
      meaning: '선한 마음과 행동은 보이지 않아도 멀리까지 향기처럼 전해집니다.',
      ttsSummary: '법구경 제54게. 꽃향기는 바람을 거스르지 못하지만, 착한 사람의 향기는 사방으로 퍼져 나갑니다.'
    },
    {
      number: 81,
      rank: '법구경 제81게',
      title: '흔들리지 않는 바위',
      poem: '단단한 바위가 바람에 흔들리지 않듯\n지혜로운 사람은\n칭찬과 비난에 흔들리지 않는다.',
      meaning: '남의 말에 일희일비하지 말고 내 마음의 중심을 고요히 지키십시오.',
      ttsSummary: '법구경 제81게. 단단한 바위가 바람에 흔들리지 않듯, 지혜로운 사람은 칭찬과 비난에 흔들리지 않습니다.'
    },
    {
      number: 103,
      rank: '법구경 제103게',
      title: '가장 큰 승리',
      poem: '싸움터에서 백만 명을 이기는 것보다\n자기 자신 하나를 이기는 사람이\n참으로 가장 위대한 승리자이다.',
      meaning: '오늘 이겨야 할 상대는 남이 아니라 게으름과 조급함, 그리고 화내는 마음입니다.',
      ttsSummary: '법구경 제103게. 백만 명을 이기는 것보다, 자기 자신을 이기는 사람이 가장 위대한 승리자입니다.'
    },
    {
      number: 122,
      rank: '법구경 제122게',
      title: '물방울이 항아리를 채우듯',
      poem: '작은 선이라 가볍게 여기지 마라.\n물방울이 모여 항아리를 채우듯\n지혜로운 이는 조금씩 선을 쌓아 복으로 가득 찬다.',
      meaning: '작은 친절 하나, 따뜻한 말 한마디가 쌓여 큰 복이 됩니다.',
      ttsSummary: '법구경 제122게. 물방울이 모여 항아리를 채우듯, 작은 선이 쌓여 큰 복이 됩니다.'
    },
    {
      number: 183,
      rank: '법구경 제183게',
      title: '모든 부처님의 가르침',
      poem: '모든 악을 짓지 말고\n모든 선을 받들어 행하며\n스스로 그 마음을 깨끗이 하라.\n이것이 모든 부처님의 가르침이다.',
      meaning: '불교의 핵심은 어렵지 않습니다. 나쁜 일을 멈추고, 좋은 일을 하고, 마음을 맑게 하는 것입니다.',
      ttsSummary: '법구경 제183게. 모든 악을 짓지 말고, 모든 선을 행하며, 스스로 마음을 깨끗이 하라. 이것이 모든 부처님의 가르침입니다.'
    },
    {
      number: 197,
      rank: '법구경 제197게',
      title: '미움 없는 행복',
      poem: '미워하는 사람들 가운데서도\n미워하지 않으며\n우리는 참으로 행복하게 살아가리라.',
      meaning: '세상이 거칠어도 내 마음까지 거칠어질 필요는 없습니다.',
      ttsSummary: '법구경 제197게. 미워하는 사람들 가운데서도 미워하지 않으며, 우리는 행복하게 살아갑니다.'
    },
    {
      number: 204,
      rank: '법구경 제204게',
      title: '가장 큰 재산',
      poem: '건강은 가장 큰 이익이요\n만족은 가장 큰 재산이며\n믿음은 가장 좋은 벗이요\n열반은 가장 큰 행복이다.',
      meaning: '오늘 내가 이미 가진 건강과 사람들에게 감사하는 마음이 가장 큰 부자입니다.',
      ttsSummary: '법구경 제204게. 건강은 가장 큰 이익이요, 만족은 가장 큰 재산이며, 믿음은 가장 좋은 벗입니다.'
    },
    {
      number: 223,
      rank: '법구경 제223게',
      title: '선으로 악을 이긴다',
      poem: '성냄은 성내지 않음으로 이기고\n악은 선으로 이기며\n인색함은 베풂으로 이기고\n거짓은 진실로 이겨라.',
      meaning: '화가 날 때 한 번 더 숨을 고르는 것, 그것이 이기는 길입니다.',
      ttsSummary: '법구경 제223게. 성냄은 성내지 않음으로, 악은 선으로, 인색함은 베풂으로, 거짓은 진실로 이겨라.'
    },
    {
      number: 276,
      rank: '법구경 제276게',
      title: '스스로 걸어가는 길',
      poem: '그대 스스로 힘써 노력하라.\n여래는 다만 길을 가리킬 뿐이니\n그 길을 걷는 이가 괴로움에서 벗어나리라.',
      meaning: '부처님은 길을 보여 주실 뿐, 한 걸음 한 걸음은 내가 걸어야 합니다.',
      ttsSummary: '법구경 제276게. 그대 스스로 힘써 노력하라. 여래는 다만 길을 가리킬 뿐입니다.'
    },
    {
      number: 50,
      rank: '법구경 제50게',
      title: '나를 돌아보는 마음',
      poem: '남의 허물을 보지 말고\n남이 한 일과 하지 않은 일을 보지 말며\n오직 내가 한 일과 하지 않은 일을 살펴라.',
      meaning: '남을 탓하기 전에 나를 먼저 돌아보면 관계가 부드러워집니다.',
      ttsSummary: '법구경 제50게. 남의 허물을 보지 말고, 오직 내가 한 일과 하지 않은 일을 살펴라.'
    }
  ],

  // Giả lập: CHỈ dùng khi thử nghiệm (đừng bật lúc phát thật — người xem sẽ tưởng là người thật)
  sim: [
    { user: '연화심', uniqueId: 'lotus_mind', wish: '부모님 건강하시고 오래오래 행복하시기를 발원합니다' },
    { user: '김지현', uniqueId: 'jihyun.k', wish: '올해 시험에 꼭 합격하게 해 주세요' },
    { user: '박서준', uniqueId: 'seojun_p', wish: '사업이 순조롭게 잘 풀리기를 기원합니다' },
    { user: '이하은', uniqueId: 'haeun.lee', wish: '가족 모두 무탈하고 평안하기를' },
    { user: '최민호', uniqueId: 'minho_c', wish: '오늘의 말씀 부탁드립니다' },
    { user: '정수아', uniqueId: 'sua.jung', wish: '세상의 모든 존재가 행복하기를' }
  ],

  // Khi phòng vắng lâu: đọc một lời Phật dạy (nội dung thật, không giả người xem)
  idleTalks: [
    '나무아미타불. 이곳은 언제나 열려 있는 온라인 법당입니다. 댓글로 소원을 남겨 주시면 함께 발원해 드립니다.',
    '잠시 숨을 깊이 들이쉬고 내쉬어 봅니다. 지금 이 순간, 마음이 조금 더 편안해지기를 바랍니다.',
    '댓글에 기도, 소원, 또는 오늘의 말씀이라고 남겨 주세요. 부처님 말씀을 한 구절 읽어 드립니다.'
  ],

  // Lịch lễ theo giờ Hàn Quốc (KST). Chùa Hàn truyền thống: 새벽예불 (lễ khuya), 사시불공 (lễ trưa), 저녁예불 (lễ chiều).
  // Tiếng chuông: sáng gõ 28 tiếng, chiều 33 tiếng là tục lệ thật; ở đây chỉ gõ tượng trưng vài tiếng.
  schedule: [
    {
      time: '04:00',
      title: '새벽예불',
      bells: 5,
      text: '지금은 새벽 예불 시간입니다. 고요한 새벽, 범종 소리와 함께 모든 이의 평안을 발원합니다. 나무아미타불.'
    },
    {
      time: '10:00',
      title: '사시불공',
      bells: 3,
      text: '사시 불공 시간입니다. 부처님께 정성을 올리며 오늘 하루의 건강과 평안을 기원합니다.'
    },
    {
      time: '18:00',
      title: '저녁예불',
      bells: 5,
      text: '저녁 예불 시간입니다. 오늘 하루 수고 많으셨습니다. 범종 소리에 하루의 근심을 내려놓으세요.'
    },
    {
      time: '22:00',
      title: '취침 전 명상',
      bells: 1,
      text: '하루를 마무리하는 시간입니다. 오늘 감사했던 일 세 가지를 떠올리며 편안히 쉬세요.'
    }
  ],

  // Câu chữ hiện trên màn hình người xem (phòng Chùa)
  ui: {
    pageTitle: '온라인 법당 · 아미타불 라이브',
    brand: '온라인 법당 • 아미타불',
    brandSim: '온라인 법당 • 시뮬레이션 모드',
    liveViewers: 'LIVE @{user} • {n}명 시청 중',
    connecting: '@{user} 연결 중...',
    unitIncense: '향',
    unitMerit: '공덕',
    meritFloat: '+{n} 공덕',
    defaultName: '불자님',
    defaultAction: '✨ 향을 올리며 기도합니다',
    defaultWish: '나무아미타불, 모두가 평안하기를',
    leaderMerit: '✨ 공덕 {n}',
    actIncense: '🔥 향 {count}개 공양 (+{merit})',
    actBell: '🔔 범종 타종 (+{merit})',
    actPrayer: '🏮 연등 발원 (+{merit})',
    actGift: '🪷 {gift} (+{merit})',
    actGrand: '🐉 {gift} (+{merit})',
    actWoodfish: '🪵 목탁 {count}번',
    fortuneDrawing: '📿 말씀을 펼치는 중...',
    fortuneDrawingWish: '{user}님을 위한 부처님 말씀을 찾고 있습니다...',
    fortuneResult: '📿 {rank}',
    fortuneTitle: '{rank} — {title}',
    fortuneDevotee: '{user}님을 위한 오늘의 말씀',
    fortuneMeaning: '마음에 새기기: {meaning}',
    grandSub: '{user}님 • 공덕이 한량없습니다 (+{merit})',
    hsBell: '범종',
    hsWoodfish: '목탁',
    hsFortune: '오늘의 말씀',
    cardIncenseTag: '댓글 · 기도',
    cardIncense: '향 공양',
    cardBlessingTag: '좋아요 · 목탁',
    cardBlessing: '연등 발원',
    cardLotusTag: '선물 · 공양',
    cardLotus: '연꽃',
    lbHeader: '정성을 올린 분들',
    lanternLabel: '🏮 연등 발원',
    scheduleBadge: '🔔 {title}',
    clockLabel: '서울'
  }
};
