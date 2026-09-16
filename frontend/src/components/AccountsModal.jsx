/**
 * AccountsModal — الحسابات (Accounts)
 * 
 * Shows:
 * - Financial overview: revenue, center share, assistant costs, expenses, net profit
 * - Group pricing configuration
 * - Center share configuration
 * - Assistant cost configuration
 * - Payment recording per student
 * - Expense tracking
 * - Payment status overview per student/group
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import { useSettings } from '../context/SettingsContext'
import { useToast } from '../context/ToastContext'

export default function AccountsModal({ open, onClose, students, groups }) {
  const { effectiveTeacherId } = useAuth()
  const { t, isArabic } = useLanguage()
  const { settings, updateSettings } = useSettings()
  const { showToast } = useToast()

  const [activeTab, setActiveTab] = useState('overview')
  const [loading, setLoading] = useState(false)
  const [payments, setPayments] = useState([])
  const [expenses, setExpenses] = useState([])
  const [summary, setSummary] = useState(null)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [groupFilter, setGroupFilter] = useState('')
  const [studentPaymentStatuses, setStudentPaymentStatuses] = useState([])

  // Payment form state
  const [payForm, setPayForm] = useState({ studentId: '', amount: '', note: '', method: 'cash' })
  const [paying, setPaying] = useState(false)

  // Expense form state
  const [expForm, setExpForm] = useState({ description: '', amount: '', category: 'other', note: '', date: '' })
  const [savingExp, setSavingExp] = useState(false)

  // Pricing config
  const [groupPricing, setGroupPricing] = useState({})
  const [pricingRules, setPricingRules] = useState([])
  const [centerShareType, setCenterShareType] = useState('fixed')
  const [centerShareValue, setCenterShareValue] = useState(0)
  const [assistantCosts, setAssistantCosts] = useState({})
  const [savingPricing, setSavingPricing] = useState(false)

  // Quick payment (inline in student list)
  const [quickPayStudent, setQuickPayStudent] = useState(null)
  const [quickPayAmount, setQuickPayAmount] = useState('')
  const [quickPaying, setQuickPaying] = useState(false)

  const loadPayments = useCallback(async () => {
    if (!effectiveTeacherId) return
    let query = supabase
      .from('student_payments')
      .select('*, student:students(name, group_name, code)')
      .eq('teacher_id', effectiveTeacherId)
      .order('payment_date', { ascending: false })
      .limit(200)

    if (dateFrom) query = query.gte('payment_date', dateFrom)
    if (dateTo) query = query.lte('payment_date', dateTo)

    const { data } = await query
    setPayments(data || [])
  }, [effectiveTeacherId, dateFrom, dateTo])

  const loadExpenses = useCallback(async () => {
    if (!effectiveTeacherId) return
    let query = supabase
      .from('expenses')
      .select('*')
      .eq('teacher_id', effectiveTeacherId)
      .order('expense_date', { ascending: false })
      .limit(200)

    if (dateFrom) query = query.gte('expense_date', dateFrom)
    if (dateTo) query = query.lte('expense_date', dateTo)

    const { data } = await query
    setExpenses(data || [])
  }, [effectiveTeacherId, dateFrom, dateTo])

  const loadSummary = useCallback(async () => {
    if (!effectiveTeacherId) return
    const { data } = await supabase.rpc('get_accounts_summary', {
      p_teacher_id: effectiveTeacherId,
      p_date_from: dateFrom || null,
      p_date_to: dateTo || null,
      p_group_name: groupFilter || null,
    })
    setSummary(data)
  }, [effectiveTeacherId, dateFrom, dateTo, groupFilter])

  const loadPaymentStatuses = useCallback(async () => {
    if (!effectiveTeacherId) return
    const { data } = await supabase.rpc('get_student_payment_statuses', {
      p_teacher_id: effectiveTeacherId,
      p_group_name: groupFilter || null,
    })
    setStudentPaymentStatuses(data || [])
  }, [effectiveTeacherId, groupFilter])

  useEffect(() => {
    if (!open) return
    setLoading(true)
    // Load pricing config from settings
    if (settings) {
      setGroupPricing(settings.group_pricing || {})
      setPricingRules(Array.isArray(settings.pricing_rules) ? settings.pricing_rules : [])
      setCenterShareType(settings.center_share_type || 'fixed')
      setCenterShareValue(settings.center_share_value || 0)
      setAssistantCosts(settings.assistant_costs || {})
    }
    Promise.all([loadPayments(), loadExpenses(), loadSummary(), loadPaymentStatuses()])
      .finally(() => setLoading(false))
  }, [open, loadPayments, loadExpenses, loadSummary, loadPaymentStatuses, settings])

  const handleSavePricing = async () => {
    setSavingPricing(true)
    await updateSettings({
      group_pricing: groupPricing,
      pricing_rules: pricingRules,
      center_share_type: centerShareType,
      center_share_value: Number(centerShareValue),
      assistant_costs: assistantCosts,
    })
    setSavingPricing(false)
    showToast(isArabic ? 'تم حفظ إعدادات الأسعار' : 'Pricing settings saved', 'success')
    loadSummary()
    loadPaymentStatuses()
  }

  const handleRecordPayment = async () => {
    if (!payForm.studentId || !payForm.amount || Number(payForm.amount) <= 0) return
    setPaying(true)
    const { error } = await supabase.from('student_payments').insert({
      teacher_id: effectiveTeacherId,
      student_id: payForm.studentId,
      amount: Number(payForm.amount),
      method: payForm.method,
      note: payForm.note,
      payment_date: new Date().toISOString().split('T')[0],
    })
    if (!error) {
      setPayForm({ studentId: '', amount: '', note: '', method: 'cash' })
      showToast(isArabic ? 'تم تسجيل الدفعة' : 'Payment recorded', 'success')
      loadPayments()
      loadSummary()
      loadPaymentStatuses()
    } else {
      showToast(error.message, 'error')
    }
    setPaying(false)
  }

  const handleQuickPay = async (studentId, amount) => {
    if (!amount || Number(amount) <= 0) return
    setQuickPaying(true)
    const { error } = await supabase.from('student_payments').insert({
      teacher_id: effectiveTeacherId,
      student_id: studentId,
      amount: Number(amount),
      method: 'cash',
      payment_date: new Date().toISOString().split('T')[0],
    })
    if (!error) {
      showToast(isArabic ? 'تم تسجيل الدفعة' : 'Payment recorded', 'success')
      setQuickPayStudent(null)
      setQuickPayAmount('')
      loadPayments()
      loadSummary()
      loadPaymentStatuses()
    }
    setQuickPaying(false)
  }

  const handleDeletePayment = async (id) => {
    await supabase.from('student_payments').delete().eq('id', id)
    loadPayments(); loadSummary(); loadPaymentStatuses()
  }

  const handleAddExpense = async () => {
    if (!expForm.description || !expForm.amount || Number(expForm.amount) <= 0) return
    setSavingExp(true)
    const { error } = await supabase.from('expenses').insert({
      teacher_id: effectiveTeacherId,
      description: expForm.description,
      amount: Number(expForm.amount),
      category: expForm.category,
      note: expForm.note,
      expense_date: expForm.date || new Date().toISOString().split('T')[0],
    })
    if (!error) {
      setExpForm({ description: '', amount: '', category: 'other', note: '', date: '' })
      showToast(isArabic ? 'تم تسجيل المصروف' : 'Expense recorded', 'success')
      loadExpenses(); loadSummary()
    }
    setSavingExp(false)
  }

  const handleDeleteExpense = async (id) => {
    await supabase.from('expenses').delete().eq('id', id)
    loadExpenses(); loadSummary()
  }

  const getPaymentStatusDisplay = (status, remaining) => {
    if (status === 'paid') return <span className="text-emerald-400 font-bold">✓ {isArabic ? 'مدفوع' : 'Paid'}</span>
    if (status === 'partial') return <span className="text-amber-400 font-bold">◐ {isArabic ? 'جزئي' : 'Partial'} — {remaining} {isArabic ? 'ج.م' : 'EGP'}</span>
    return <span className="text-rose-400 font-bold">⚠ {isArabic ? 'غير مدفوع' : 'Unpaid'}</span>
  }

  const TABS = [
    ['overview', '💰', isArabic ? 'نظرة عامة' : 'Overview'],
    ['pricing', '🏷️', isArabic ? 'الأسعار' : 'Pricing'],
    ['payments', '💵', isArabic ? 'المدفوعات' : 'Payments'],
    ['expenses', '📋', isArabic ? 'المصروفات' : 'Expenses'],
    ['students_tab', '👥', isArabic ? 'حالة الطلاب' : 'Student Status'],
  ]

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto">
      <div className="glass-card rounded-2xl w-full max-w-4xl my-8 shadow-2xl" dir={isArabic ? 'rtl' : 'ltr'}>
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-subtle">
          <h2 className="text-lg font-black text-fg">{isArabic ? '💰 الحسابات' : '💰 Accounts'}</h2>
          <button onClick={onClose} className="text-fg-subtle hover:text-fg text-xl">✕</button>
        </div>

        {/* Filters */}
        <div className="p-4 border-b border-subtle flex flex-wrap gap-2 items-center">
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="glass-input rounded-lg px-3 py-2 text-sm outline-none border border-subtle" />
          <span className="text-fg-subtle text-xs">→</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="glass-input rounded-lg px-3 py-2 text-sm outline-none border border-subtle" />
          <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} className="glass-input rounded-lg px-3 py-2 text-sm outline-none border border-subtle">
            <option value="">{isArabic ? 'كل المجموعات' : 'All Groups'}</option>
            {groups.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-subtle overflow-x-auto">
          {TABS.map(([key, icon, label]) => (
            <button key={key} onClick={() => setActiveTab(key)} className={`px-4 py-3 text-sm font-bold whitespace-nowrap border-b-2 transition-colors ${activeTab === key ? 'text-brand-gold-hover border-brand-gold' : 'text-fg-subtle border-transparent hover:text-fg'}`}>{icon} {label}</button>
          ))}
        </div>

        <div className="p-5 max-h-[60vh] overflow-y-auto">
          {loading ? (
            <div className="text-center py-8 text-fg-subtle">{isArabic ? 'جاري التحميل...' : 'Loading...'}</div>
          ) : (
            <>
              {/* ═══ OVERVIEW TAB ═══ */}
              {activeTab === 'overview' && summary && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <SummaryCard isArabic={isArabic} label={isArabic ? 'إجمالي الإيرادات' : 'Total Revenue'} value={summary.totalRevenue} color="text-emerald-400" />
                    <SummaryCard label={isArabic ? 'المدفوعات المستلمة' : 'Payments Received'} value={summary.studentPaymentsReceived} color="text-blue-400" />
                    <SummaryCard label={isArabic ? 'حصة المركز' : 'Center Share'} value={summary.centerShare} color="text-amber-400" subtitle={summary.centerShareType === 'percentage' ? `${summary.centerShareValue}%` : `${summary.centerShareValue} ${isArabic ? 'ج.م/حصة' : 'EGP/lesson'}`} />
                    <SummaryCard label={isArabic ? 'تكاليف المساعدين' : 'Assistant Costs'} value={summary.assistantCosts} color="text-violet-400" />
                    <SummaryCard label={isArabic ? 'المصروفات الأخرى' : 'Other Expenses'} value={summary.expenses} color="text-rose-400" />
                    <SummaryCard label={isArabic ? 'صافي الربح' : 'Net Profit'} value={summary.netProfit} color={summary.netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'} bold />
                  </div>
                  <div className="text-xs text-fg-subtle text-center">
                    {isArabic ? 'عدد الحصص' : 'Lesson count'}: {summary.lessonCount}
                  </div>
                </div>
              )}

              {/* ═══ PRICING TAB ═══ */}
              {activeTab === 'pricing' && (
                <div className="space-y-6">
                  {/* Rule-based pricing: group + stage takes priority. */}
                  <div>
                    <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-bold text-fg">🏷️ {isArabic ? 'أسعار ثابتة حسب المرحلة والمجموعة' : 'Fixed pricing by stage and group'}</h3><button type="button" onClick={() => setPricingRules((r) => [...r, { label: '', stage: '', group_name: '', price: '' }])} className="text-brand-gold-hover text-xs font-bold">+ {isArabic ? 'قاعدة سعر' : 'Add rule'}</button></div>
                    <p className="text-fg-subtle text-xs mb-3">{isArabic ? 'القاعدة التي تحتوي المرحلة والمجموعة لها الأولوية، ثم المجموعة، ثم المرحلة.' : 'A stage+group rule has priority, then group, then stage.'}</p>
                    <div className="space-y-2">{pricingRules.map((rule, idx) => (<div key={idx} className="grid sm:grid-cols-[1.2fr_1fr_1fr_110px_auto] gap-2 items-center glass-card rounded-lg p-2"><input value={rule.label || ''} onChange={(e) => setPricingRules((r) => r.map((x,i) => i===idx ? {...x,label:e.target.value} : x))} placeholder={isArabic ? 'اسم القاعدة/المركز' : 'Rule label'} className="glass-input rounded px-2 py-1.5 text-xs outline-none border border-subtle" /><input value={rule.stage || ''} onChange={(e) => setPricingRules((r) => r.map((x,i) => i===idx ? {...x,stage:e.target.value} : x))} placeholder={isArabic ? 'المرحلة' : 'Stage'} className="glass-input rounded px-2 py-1.5 text-xs outline-none border border-subtle" /><select value={rule.group_name || ''} onChange={(e) => setPricingRules((r) => r.map((x,i) => i===idx ? {...x,group_name:e.target.value} : x))} className="glass-input rounded px-2 py-1.5 text-xs outline-none border border-subtle"><option value="">{isArabic ? 'كل المجموعات' : 'All groups'}</option>{groups.map((g) => <option key={g} value={g}>{g}</option>)}</select><input type="number" min="0" value={rule.price ?? ''} onChange={(e) => setPricingRules((r) => r.map((x,i) => i===idx ? {...x,price:e.target.value} : x))} placeholder={isArabic ? 'السعر' : 'Price'} className="glass-input rounded px-2 py-1.5 text-xs outline-none border border-subtle" /><button type="button" onClick={() => setPricingRules((r) => r.filter((_,i) => i!==idx))} className="text-rose-400 text-xs">🗑️</button></div>))}{pricingRules.length===0 && <p className="text-fg-subtle text-xs">{isArabic ? 'أضف أول قاعدة سعر.' : 'Add the first pricing rule.'}</p>}</div>
                  </div>

                  {/* Center Share */}
                  <div>
                    <h3 className="text-sm font-bold text-fg mb-3">🏢 {isArabic ? 'حصة المركز' : 'Center Share'}</h3>
                    <div className="flex items-center gap-3 mb-2">
                      <select value={centerShareType} onChange={(e) => setCenterShareType(e.target.value)} className="glass-input rounded-lg px-3 py-2 text-sm outline-none border border-subtle">
                        <option value="fixed">{isArabic ? 'مبلغ ثابت لكل حصة' : 'Fixed per lesson'}</option>
                        <option value="percentage">{isArabic ? 'نسبة مئوية' : 'Percentage'}</option>
                      </select>
                      <input type="number" min="0" value={centerShareValue || ''} onChange={(e) => setCenterShareValue(e.target.value ? Number(e.target.value) : 0)} placeholder="0" className="glass-input rounded-lg px-3 py-2 text-sm outline-none border border-subtle w-32" />
                      <span className="text-fg-subtle text-xs">{centerShareType === 'percentage' ? '%' : isArabic ? 'ج.م' : 'EGP'}</span>
                    </div>
                  </div>

                  {/* Assistant Costs */}
                  <div>
                    <h3 className="text-sm font-bold text-fg mb-3">👤 {isArabic ? 'تكلفة المساعدين (ج.م/حصة)' : 'Assistant Costs (EGP/lesson)'}</h3>
                    <p className="text-fg-subtle text-xs mb-2">{isArabic ? 'أدخل تكلفة كل مساعد لكل حصة' : 'Enter cost per lesson for each assistant'}</p>
                    <div className="space-y-2">
                      {Object.keys(assistantCosts).length === 0 && (
                        <p className="text-fg-subtle text-xs">{isArabic ? 'لا يوجد مساعدين مربوطين حاليًا' : 'No assistants linked currently'}</p>
                      )}
                      {Object.entries(assistantCosts).map(([id, cost]) => (
                        <div key={id} className="flex items-center gap-2">
                          <span className="text-sm text-fg w-32 shrink-0 font-mono text-xs">{id.slice(0, 8)}...</span>
                          <input type="number" min="0" value={cost || ''} onChange={(e) => setAssistantCosts({ ...assistantCosts, [id]: e.target.value ? Number(e.target.value) : null })} className="glass-input rounded-lg px-3 py-2 text-sm outline-none border border-subtle flex-1" />
                          <span className="text-fg-subtle text-xs">{isArabic ? 'ج.م/حصة' : 'EGP/lesson'}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <button onClick={handleSavePricing} disabled={savingPricing} className="btn-glow font-bold px-5 py-2.5 rounded-xl text-sm disabled:opacity-50">
                    {savingPricing ? '⏳ ...' : `💾 ${isArabic ? 'حفظ الإعدادات' : 'Save Settings'}`}
                  </button>
                </div>
              )}

              {/* ═══ PAYMENTS TAB ═══ */}
              {activeTab === 'payments' && (
                <div className="space-y-4">
                  {/* Record Payment Form */}
                  <div className="glass-card rounded-xl p-4 space-y-3">
                    <h3 className="text-sm font-bold text-fg">+ {isArabic ? 'تسجيل دفعة جديدة' : 'Record New Payment'}</h3>
                    <div className="grid sm:grid-cols-2 gap-2">
                      <select value={payForm.studentId} onChange={(e) => setPayForm({ ...payForm, studentId: e.target.value })} className="glass-input rounded-lg px-3 py-2 text-sm outline-none border border-subtle">
                        <option value="">{isArabic ? 'اختر طالب' : 'Choose student'}</option>
                        {students.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.group_name})</option>)}
                      </select>
                      <input type="number" min="0" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} placeholder={isArabic ? 'المبلغ (ج.م)' : 'Amount (EGP)'} className="glass-input rounded-lg px-3 py-2 text-sm outline-none border border-subtle" />
                      <select value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })} className="glass-input rounded-lg px-3 py-2 text-sm outline-none border border-subtle">
                        <option value="cash">{isArabic ? 'نقدي' : 'Cash'}</option>
                        <option value="transfer">{isArabic ? 'تحويل' : 'Transfer'}</option>
                        <option value="other">{isArabic ? 'أخرى' : 'Other'}</option>
                      </select>
                      <input value={payForm.note} onChange={(e) => setPayForm({ ...payForm, note: e.target.value })} placeholder={isArabic ? 'ملاحظة (اختياري)' : 'Note (optional)'} className="glass-input rounded-lg px-3 py-2 text-sm outline-none border border-subtle" />
                    </div>
                    <button onClick={handleRecordPayment} disabled={paying || !payForm.studentId || !payForm.amount} className="btn-glow font-bold px-4 py-2 rounded-xl text-sm disabled:opacity-50">
                      {paying ? '⏳' : `✅ ${isArabic ? 'تسجيل' : 'Record'}`}
                    </button>
                  </div>

                  {/* Payments List */}
                  <div className="glass-card rounded-xl overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="glass-input text-fg-muted text-xs">
                        <tr><th className="p-3">{isArabic ? 'التاريخ' : 'Date'}</th><th className="p-3 text-right">{isArabic ? 'الطالب' : 'Student'}</th><th className="p-3">{isArabic ? 'المبلغ' : 'Amount'}</th><th className="p-3">{isArabic ? 'الطريقة' : 'Method'}</th><th className="p-3">{isArabic ? 'ملاحظة' : 'Note'}</th><th className="p-3"></th></tr>
                      </thead>
                      <tbody>
                        {payments.map((p) => (
                          <tr key={p.id} className="border-b border-subtle hover:bg-brand-gold/5">
                            <td className="p-3 text-xs text-fg-subtle">{p.payment_date}</td>
                            <td className="p-3 font-bold text-fg">{p.student?.name || '-'}</td>
                            <td className="p-3 text-emerald-400 font-bold">{p.amount} {isArabic ? 'ج.م' : 'EGP'}</td>
                            <td className="p-3 text-fg-subtle text-xs">{p.method}</td>
                            <td className="p-3 text-fg-subtle text-xs">{p.note || '-'}</td>
                            <td className="p-3"><button onClick={() => handleDeletePayment(p.id)} className="text-rose-400 hover:text-rose-300 text-xs">🗑️</button></td>
                          </tr>
                        ))}
                        {payments.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-fg-subtle">{isArabic ? 'لا توجد مدفوعات' : 'No payments recorded'}</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ═══ EXPENSES TAB ═══ */}
              {activeTab === 'expenses' && (
                <div className="space-y-4">
                  <div className="glass-card rounded-xl p-4 space-y-3">
                    <h3 className="text-sm font-bold text-fg">+ {isArabic ? 'تسجيل مصروف جديد' : 'Record New Expense'}</h3>
                    <div className="grid sm:grid-cols-2 gap-2">
                      <input value={expForm.description} onChange={(e) => setExpForm({ ...expForm, description: e.target.value })} placeholder={isArabic ? 'الوصف' : 'Description'} className="glass-input rounded-lg px-3 py-2 text-sm outline-none border border-subtle" />
                      <input type="number" min="0" value={expForm.amount} onChange={(e) => setExpForm({ ...expForm, amount: e.target.value })} placeholder={isArabic ? 'المبلغ (ج.م)' : 'Amount (EGP)'} className="glass-input rounded-lg px-3 py-2 text-sm outline-none border border-subtle" />
                      <select value={expForm.category} onChange={(e) => setExpForm({ ...expForm, category: e.target.value })} className="glass-input rounded-lg px-3 py-2 text-sm outline-none border border-subtle">
                        <option value="rent">{isArabic ? 'إيجار' : 'Rent'}</option>
                        <option value="supplies">{isArabic ? 'مستلزمات' : 'Supplies'}</option>
                        <option value="transport">{isArabic ? 'مواصلات' : 'Transport'}</option>
                        <option value="utilities">{isArabic ? 'خدمات' : 'Utilities'}</option>
                        <option value="marketing">{isArabic ? 'تسويق' : 'Marketing'}</option>
                        <option value="other">{isArabic ? 'أخرى' : 'Other'}</option>
                      </select>
                      <input type="date" value={expForm.date} onChange={(e) => setExpForm({ ...expForm, date: e.target.value })} className="glass-input rounded-lg px-3 py-2 text-sm outline-none border border-subtle" />
                    </div>
                    <button onClick={handleAddExpense} disabled={savingExp} className="btn-glow font-bold px-4 py-2 rounded-xl text-sm disabled:opacity-50">
                      {savingExp ? '⏳' : `✅ ${isArabic ? 'تسجيل' : 'Record'}`}
                    </button>
                  </div>

                  <div className="glass-card rounded-xl overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="glass-input text-fg-muted text-xs">
                        <tr><th className="p-3">{isArabic ? 'التاريخ' : 'Date'}</th><th className="p-3 text-right">{isArabic ? 'الوصف' : 'Description'}</th><th className="p-3">{isArabic ? 'المبلغ' : 'Amount'}</th><th className="p-3">{isArabic ? 'الفئة' : 'Category'}</th><th className="p-3"></th></tr>
                      </thead>
                      <tbody>
                        {expenses.map((e) => (
                          <tr key={e.id} className="border-b border-subtle hover:bg-brand-gold/5">
                            <td className="p-3 text-xs text-fg-subtle">{e.expense_date}</td>
                            <td className="p-3 font-bold text-fg">{e.description}</td>
                            <td className="p-3 text-rose-400 font-bold">{e.amount} {isArabic ? 'ج.م' : 'EGP'}</td>
                            <td className="p-3 text-fg-subtle text-xs">{e.category}</td>
                            <td className="p-3"><button onClick={() => handleDeleteExpense(e.id)} className="text-rose-400 hover:text-rose-300 text-xs">🗑️</button></td>
                          </tr>
                        ))}
                        {expenses.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-fg-subtle">{isArabic ? 'لا توجد مصروفات' : 'No expenses recorded'}</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ═══ STUDENT STATUS TAB ═══ */}
              {activeTab === 'students_tab' && (
                <div className="space-y-4">
                  <div className="glass-card rounded-xl overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="glass-input text-fg-muted text-xs">
                        <tr>
                          <th className="p-3">{isArabic ? 'الطالب' : 'Student'}</th>
                          <th className="p-3">{isArabic ? 'المجموعة' : 'Group'}</th>
                          <th className="p-3">{isArabic ? 'المستحق' : 'Due'}</th>
                          <th className="p-3">{isArabic ? 'المدفوع' : 'Paid'}</th>
                          <th className="p-3">{isArabic ? 'المتبقي' : 'Remaining'}</th>
                          <th className="p-3">{isArabic ? 'الحالة' : 'Status'}</th>
                          <th className="p-3"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {studentPaymentStatuses.map((ps) => {
                          const student = students.find((s) => s.id === ps.student_id)
                          if (!student) return null
                          return (
                            <tr key={ps.student_id} className="border-b border-subtle hover:bg-brand-gold/5">
                              <td className="p-3 font-bold text-fg">{student.name}</td>
                              <td className="p-3 text-fg-subtle text-xs">{student.group_name}</td>
                              <td className="p-3">{ps.total_due} {isArabic ? 'ج.م' : 'EGP'}</td>
                              <td className="p-3 text-emerald-400">{ps.total_paid} {isArabic ? 'ج.م' : 'EGP'}</td>
                              <td className="p-3 text-rose-400">{Math.max(0, ps.remaining)} {isArabic ? 'ج.م' : 'EGP'}</td>
                              <td className="p-3">{getPaymentStatusDisplay(ps.status, ps.remaining)}</td>
                              <td className="p-3">
                                {quickPayStudent === ps.student_id ? (
                                  <div className="flex items-center gap-1">
                                    <input type="number" min="0" value={quickPayAmount} onChange={(e) => setQuickPayAmount(e.target.value)} placeholder={isArabic ? 'المبلغ' : 'Amount'} className="w-20 glass-input rounded px-2 py-1 text-xs outline-none border border-subtle" />
                                    <button onClick={() => handleQuickPay(ps.student_id, quickPayAmount)} disabled={quickPaying} className="text-emerald-400 text-xs font-bold">✓</button>
                                    <button onClick={() => { setQuickPayStudent(null); setQuickPayAmount('') }} className="text-fg-subtle text-xs">✕</button>
                                  </div>
                                ) : (
                                  <button onClick={() => setQuickPayStudent(ps.student_id)} className="text-brand-gold-hover text-xs font-bold">+ {isArabic ? 'دفع' : 'Pay'}</button>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                        {studentPaymentStatuses.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-fg-subtle">{isArabic ? 'لا توجد بيانات' : 'No data'}</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function SummaryCard({ isArabic, label, value, color, subtitle, bold }) {
  return (
    <div className="glass-card rounded-xl p-4 text-center">
      <p className={`text-2xl font-black ${color} ${bold ? 'text-3xl' : ''}`}>{Number(value || 0).toLocaleString()} {isArabic ? 'ج.م' : 'EGP'}</p>
      <p className="text-fg-subtle text-xs mt-1">{label}</p>
      {subtitle && <p className="text-fg-subtle text-[10px]">{subtitle}</p>}
    </div>
  )
}