const KOREAN_ADDRESS = /(?:서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|제주특별자치도|[가-힣]+도)\s+[가-힣0-9·-]+(?:시|군|구)\s+[가-힣0-9·-]+(?:읍|면|동|로|길)(?:\s+[0-9]{1,5}(?:-[0-9]{1,5})?)?/g;
const STREET_ADDRESS = /(?<![가-힣0-9])[가-힣0-9·-]{2,}(?:로|길)\s+[0-9]{1,5}(?:-[0-9]{1,5})?(?![0-9])/g;
const RESIDENT_REGISTRATION_NUMBER = /(?<![0-9])[0-9]{6}-[1-4][0-9]{6}(?![0-9])/g;
const PHONE_NUMBER = /(?<![0-9])(?:(?:\+?82)[-.\s]?(?:10|[2-9][0-9]?)|01[016789]|0[2-9][0-9]?)[-.\s]?[0-9]{3,4}[-.\s]?[0-9]{4}(?![0-9])/g;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const LABELED_KOREAN_NAME = /(성명|이름)(\s*(?:은|는|:|=)\s*)[가-힣]{2,4}?(?=이고|이며|이에요|예요|입니다|님|[,\.\s]|$)/g;
const HONORIFIC_KOREAN_NAME = /(?<![가-힣])([가-힣]{2,4})(?=님|\s+씨(?:\s|[,\.]|$))/g;

export function maskPii(value) {
  if (typeof value !== 'string') return value;

  return value
    .replace(RESIDENT_REGISTRATION_NUMBER, '[주민번호 마스킹]')
    .replace(EMAIL, '[이메일 마스킹]')
    .replace(PHONE_NUMBER, '[연락처 마스킹]')
    .replace(KOREAN_ADDRESS, '[주소 마스킹]')
    .replace(STREET_ADDRESS, '[주소 마스킹]')
    .replace(LABELED_KOREAN_NAME, '$1$2[이름 마스킹]')
    .replace(HONORIFIC_KOREAN_NAME, '[이름 마스킹]');
}

export function maskPiiDeep(value) {
  if (typeof value === 'string') return maskPii(value);
  if (Array.isArray(value)) return value.map(maskPiiDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, maskPiiDeep(child)]),
    );
  }
  return value;
}
