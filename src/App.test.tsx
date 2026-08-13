import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./Operations', () => ({
  SurveyorPage: () => <main><h1>오늘 연락할 대상</h1><fieldset><legend>통화 결과 입력</legend></fieldset></main>,
  ManagerPage: () => <main><h1>방문 권고 승인</h1><h2>담당자 승인 대기</h2></main>,
}))

import App from './App'

describe('P2 Care Operations routes', () => {
  it('routes /ops/surveyor without starting the public map', () => {
    window.history.pushState({}, '', '/ops/surveyor')
    render(<App />)
    expect(screen.getByRole('heading', { name: '오늘 연락할 대상' })).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('[합성]')
    expect(screen.getByRole('group', { name: '통화 결과 입력' })).toBeInTheDocument()
  })

  it('routes /ops/manager without starting the public map', () => {
    window.history.pushState({}, '', '/ops/manager')
    render(<App />)
    expect(screen.getByRole('heading', { name: '방문 권고 승인' })).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('[합성]')
    expect(screen.getByText('담당자 승인 대기')).toBeInTheDocument()
  })
})
