const CASE_ID_PATTERN = /^SYN-HH-\d{10}-\d{4}$/

const FAMILY_NAMES = [
  '김', '이', '박', '최', '정', '강', '조', '윤', '장', '임',
  '한', '오', '서', '신', '권', '황', '안', '송', '전', '홍',
] as const

const GIVEN_NAMES = [
  '영자', '순자', '정자', '미자', '춘자', '옥자', '명자', '경자', '복자', '금자',
  '영숙', '정숙', '현숙', '선희', '영희', '순희', '명희', '성자', '은자', '화자',
  '점순', '말순', '재순', '봉순', '영순', '순덕', '정순', '미순', '경순', '명순',
  '영옥', '정옥', '미옥', '명옥', '길자', '귀자', '영수', '성수', '동수', '종수',
  '정호', '영호', '성호', '태수', '창수', '만수', '덕수', '병철', '상철', '영철',
] as const

export function caseDisplayName(caseId: string) {
  if (!CASE_ID_PATTERN.test(caseId)) throw new TypeError('case ID cannot be mapped to a display name')
  const dongCode = caseId.slice(7, 17)
  const index = Math.max(Number(caseId.slice(-4)) - 1, 0)
  return `${FAMILY_NAMES[(Number(dongCode.slice(-2)) + index) % FAMILY_NAMES.length]}${GIVEN_NAMES[index % GIVEN_NAMES.length]}`
}
