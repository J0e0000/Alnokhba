import { db } from "../src/lib/db"
import { hashPassword } from "../src/lib/auth"
import { generateToken } from "../src/lib/validation"

async function main() {
  const email = "teacher@nokhba.demo"
  let teacher = await db.teacher.findUnique({ where: { email } })
  if (!teacher) {
    teacher = await db.teacher.create({
      data: {
        email,
        passwordHash: await hashPassword("123456"),
        fullName: "مستر أحمد النخباوي",
        centerName: "مركز النخبة التعليمي",
        phone: "01012345678",
        whatsappNumber: "201012345678",
        subscriptionStatus: "trial",
        subscriptionExpiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365 * 5),
        absenceThreshold: 3,
      },
    })
  }

  const groupsData = [
    { name: "أولى ثانوي — مجموعة السبت", stage: "ثانوي", days: [6], time: "10:00" },
    { name: "ثانية إعدادي — مجموعة الإثنين", stage: "إعدادي", days: [1], time: "14:00" },
    { name: "سادسة ابتدائي — مجموعة الأربعاء", stage: "ابتدائي", days: [3], time: "16:00" },
  ]
  const groups = []
  for (const g of groupsData) {
    let row = await db.group.findFirst({ where: { teacherId: teacher.id, name: g.name } })
    if (!row) {
      row = await db.group.create({
        data: {
          teacherId: teacher.id,
          name: g.name,
          stage: g.stage,
          scheduleDays: JSON.stringify(g.days),
          scheduleTime: g.time,
        },
      })
    }
    groups.push(row)
  }

  const sampleNames = [
    "أحمد محمد", "محمود علي", "يوسف إبراهيم", "عمر خالد", "خالد سعيد",
    "مريم أحمد", "فاطمة عبد الله", "نور الدين", "سلمان مصطفى", "حسن كريم",
    "زيدان طارق", "آدم جمال", "ملك وليد", "رانيا سعيد", "بيان ماهر",
  ]
  let orderIdx = 0
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi]
    const existing = await db.student.count({ where: { groupId: g.id } })
    if (existing > 0) continue
    for (let i = 0; i < 5; i++) {
      const name = sampleNames[gi * 5 + i] || `طالب ${gi}-${i}`
      const s = await db.student.create({
        data: {
          teacherId: teacher.id,
          groupId: g.id,
          name,
          phone: `010${String(10000000 + gi * 5 + i).padStart(8, "0")}`,
          stage: g.stage,
          code: `N-${gi + 1}${i + 1}`,
          orderIdx: orderIdx++,
        },
      })
      await db.qrToken.create({
        data: { teacherId: teacher.id, studentId: s.id, token: generateToken(24) },
      })
    }
  }

  const today = new Date()
  const y = today.getFullYear()
  const m = String(today.getMonth() + 1).padStart(2, "0")
  const d = String(today.getDate()).padStart(2, "0")
  const todayStr = `${y}-${m}-${d}`
  for (const g of groups) {
    let lesson = await db.lesson.findFirst({ where: { teacherId: teacher.id, groupId: g.id, lessonDate: todayStr } })
    if (!lesson) {
      lesson = await db.lesson.create({
        data: {
          teacherId: teacher.id,
          groupId: g.id,
          title: `حصة ${g.name.split("—")[0]?.trim() || g.name}`,
          topic: "مراجعة عامة",
          lessonDate: todayStr,
          startTime: g.scheduleTime ?? "10:00",
          status: "open",
        },
      })
    }
    const sts = await db.student.findMany({ where: { groupId: g.id, archived: false }, orderBy: { orderIdx: "asc" } })
    for (let i = 0; i < sts.length; i++) {
      const s = sts[i]
      const exists = await db.attendance.findUnique({ where: { studentId_lessonId: { studentId: s.id, lessonId: lesson.id } } })
      if (exists) continue
      const status = i < 3 ? "present" : "absent"
      await db.attendance.create({
        data: {
          teacherId: teacher.id,
          studentId: s.id,
          lessonId: lesson.id,
          status,
          method: i < 3 ? "qr" : "auto",
        },
      })
    }
  }

  const firstGroup = groups[0]
  let exam = await db.exam.findFirst({ where: { teacherId: teacher.id, groupId: firstGroup.id } })
  if (!exam) {
    exam = await db.exam.create({
      data: {
        teacherId: teacher.id,
        groupId: firstGroup.id,
        title: "امتحان الوحدة الأولى — مراجعة",
        description: "امتحان شامل للوحدة الأولى",
        maxScore: 20,
        passScore: 10,
        status: "published",
        publishedAt: new Date(),
        questionsJson: JSON.stringify([
          { text: "اختر الإجابة الصحيحة:", type: "mcq", choices: ["أ", "ب", "ج", "د"], answer: 0, marks: 5 },
          { text: "اكتب المطلوب:", type: "short_answer", answer: "", marks: 5 },
          { text: "صح أم خطأ:", type: "true_false", answer: true, marks: 5 },
          { text: "سؤال مقالي:", type: "essay", answer: "", marks: 5 },
        ]),
      },
    })
    const sts = await db.student.findMany({ where: { groupId: firstGroup.id } })
    for (let i = 0; i < sts.length; i++) {
      const s = sts[i]
      const score = [18, 15, 12, 9, 20][i % 5]
      await db.examResult.create({
        data: {
          teacherId: teacher.id,
          examId: exam.id,
          studentId: s.id,
          score,
          status: "graded",
          gradedAt: new Date(),
        },
      })
    }
  }

  let hw = await db.homework.findFirst({ where: { teacherId: teacher.id, groupId: firstGroup.id } })
  if (!hw) {
    hw = await db.homework.create({
      data: {
        teacherId: teacher.id,
        groupId: firstGroup.id,
        title: "حل تمارين الوحدة الأولى",
        description: "حل التمارين من 1 إلى 10 في الكراسة.",
        dueDate: todayStr,
      },
    })
    const sts = await db.student.findMany({ where: { groupId: firstGroup.id } })
    for (let i = 0; i < sts.length; i++) {
      await db.homeworkStatus.create({
        data: { homeworkId: hw.id, studentId: sts[i].id, done: i < 2, markedBy: "teacher" },
      })
    }
  }

  const notifExists = await db.notification.count({ where: { teacherId: teacher.id } })
  if (notifExists === 0) {
    await db.notification.create({
      data: {
        teacherId: teacher.id,
        audience: "teacher",
        type: "message",
        title: "أهلاً بك في نُخبة",
        body: "تم إعداد حسابك بنجاح. ابدأ بفتح حصص اليوم من الصفحة الرئيسية.",
      },
    })
  }

  console.log("Seed done. Teacher:", teacher.email, "id:", teacher.id)
  const firstStudent = await db.student.findFirst({ where: { teacherId: teacher.id }, orderBy: { orderIdx: "asc" } })
  if (firstStudent) {
    const tok = await db.qrToken.findFirst({ where: { studentId: firstStudent.id, revokedAt: null } })
    if (tok) console.log("Sample QR token:", tok.token, "→ /qr/" + tok.token)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
