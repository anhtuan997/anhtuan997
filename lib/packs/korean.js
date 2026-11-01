// Tiện ích ngữ pháp tiếng Hàn: chọn trợ từ (조사) theo phụ âm cuối (받침) của chữ trước.
//  vd. josa('장미', '을', '를') => '장미를' ; josa('연꽃', '을', '를') => '연꽃을'
'use strict';

function hasFinalConsonant(word) {
  const s = String(word || '').trim();
  for (let i = s.length - 1; i >= 0; i--) {
    const code = s.charCodeAt(i);
    if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0;
    if (/[0-9]/.test(s[i])) return '0136781'.includes(s[i]); // 영,일,삼,육,칠,팔 có 받침
    if (/[a-zA-Z]/.test(s[i])) return /[lmnr]$/i.test(s[i]) ? true : false;
    if (/\s|[)\].!?]/.test(s[i])) continue;
    return false;
  }
  return false;
}

// Phụ âm cuối có phải ㄹ không (chỉ số 받침 = 8)
function endsWithRieul(word) {
  const s = String(word || '').trim();
  const code = s.charCodeAt(s.length - 1);
  return code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 === 8;
}

function josa(word, withBatchim, withoutBatchim) {
  // Ngoại lệ "(으)로": chữ tận cùng bằng ㄹ dùng "로" (꽃다발로, 서울로)
  if (withBatchim === '으로' && endsWithRieul(word)) return `${word}${withoutBatchim}`;
  return `${word}${hasFinalConsonant(word) ? withBatchim : withoutBatchim}`;
}

// Tên TikTok kiểu "minji_kim99" đọc lên rất khó nghe => bỏ dấu gạch, số đuôi
function speakableName(name) {
  const cleaned = String(name || '')
    .replace(/[_.\-]+/g, ' ')
    .replace(/\d{2,}\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || String(name || '');
}

module.exports = { josa, hasFinalConsonant, speakableName };
