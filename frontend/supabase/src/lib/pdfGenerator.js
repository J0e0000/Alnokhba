import jsPDF from 'jspdf'
import html2canvas from 'html2canvas-pro'

/**
 * Generate a professional PDF certificate for a student
 */
export const generateCertificate = async (studentName, achievement, teacherName, date) => {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'A4',
  })

  const width = doc.internal.pageSize.getWidth()
  const height = doc.internal.pageSize.getHeight()

  // Background color
  doc.setFillColor(14, 41, 84) // Navy
  doc.rect(0, 0, width, height, 'F')

  // Gold accent border
  doc.setDrawColor(212, 163, 115) // Gold
  doc.setLineWidth(3)
  doc.rect(10, 10, width - 20, height - 20)

  // Title
  doc.setTextColor(212, 163, 115)
  doc.setFontSize(32)
  doc.setFont('Cairo', 'bold')
  doc.text('شهادة تقدير', width / 2, 40, { align: 'center' })

  // Student name
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(24)
  doc.text(`${studentName}`, width / 2, 70, { align: 'center' })

  // Achievement text
  doc.setFontSize(14)
  doc.setTextColor(212, 163, 115)
  doc.text('لتحقيقه إنجازاً متميزاً في:', width / 2, 95, { align: 'center' })

  doc.setFontSize(16)
  doc.setTextColor(255, 255, 255)
  doc.text(achievement, width / 2, 110, { align: 'center', maxWidth: width - 40 })

  // Footer
  doc.setFontSize(11)
  doc.setTextColor(200, 200, 200)
  doc.text(`المعلم: ${teacherName}`, width / 2, height - 25, { align: 'center' })
  doc.text(`التاريخ: ${date}`, width / 2, height - 15, { align: 'center' })

  return doc
}

/**
 * Generate a monthly progress report for a student
 */
export const generateProgressReport = async (studentData, attendanceData, examData, teacherName) => {
  const doc = new jsPDF()
  const pageHeight = doc.internal.pageSize.getHeight()
  const pageWidth = doc.internal.pageSize.getWidth()
  let yPosition = 20

  // Header
  doc.setFillColor(14, 41, 84)
  doc.rect(0, 0, pageWidth, 30, 'F')
  doc.setTextColor(212, 163, 115)
  doc.setFontSize(18)
  doc.setFont('Cairo', 'bold')
  doc.text('تقرير التقدم الشهري', pageWidth / 2, 15, { align: 'center' })

  yPosition = 40

  // Student Info
  doc.setTextColor(14, 41, 84)
  doc.setFontSize(12)
  doc.setFont('Cairo', 'bold')
  doc.text(`اسم الطالب: ${studentData.name}`, 20, yPosition)
  yPosition += 8
  doc.text(`المرحلة: ${studentData.stage || 'غير محدد'}`, 20, yPosition)
  yPosition += 8
  doc.text(`المعلم: ${teacherName}`, 20, yPosition)
  yPosition += 12

  // Attendance Summary
  doc.setFont('Cairo', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(212, 163, 115)
  doc.text('ملخص الحضور', 20, yPosition)
  yPosition += 8

  doc.setFont('Cairo', 'normal')
  doc.setFontSize(11)
  doc.setTextColor(14, 41, 84)
  doc.text(`إجمالي الحضور: ${attendanceData.present || 0} يوم`, 25, yPosition)
  yPosition += 6
  doc.text(`الغياب: ${attendanceData.absent || 0} يوم`, 25, yPosition)
  yPosition += 6
  doc.text(`نسبة الحضور: ${attendanceData.percentage || 0}%`, 25, yPosition)
  yPosition += 12

  // Exam Performance
  doc.setFont('Cairo', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(212, 163, 115)
  doc.text('الأداء الأكاديمي', 20, yPosition)
  yPosition += 8

  doc.setFont('Cairo', 'normal')
  doc.setFontSize(11)
  doc.setTextColor(14, 41, 84)
  doc.text(`عدد الامتحانات: ${examData.count || 0}`, 25, yPosition)
  yPosition += 6
  doc.text(`متوسط الدرجات: ${examData.average || 0}%`, 25, yPosition)
  yPosition += 6
  doc.text(`أعلى درجة: ${examData.highest || 0}%`, 25, yPosition)
  yPosition += 12

  // Behavior & Points
  doc.setFont('Cairo', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(212, 163, 115)
  doc.text('السلوك والنقاط', 20, yPosition)
  yPosition += 8

  doc.setFont('Cairo', 'normal')
  doc.setFontSize(11)
  doc.setTextColor(14, 41, 84)
  doc.text(`النقاط الكلية: ${studentData.points || 0}`, 25, yPosition)
  yPosition += 6
  doc.text(`التقييم: ${studentData.rank || 'جيد'}`, 25, yPosition)

  // Footer
  yPosition = pageHeight - 20
  doc.setFontSize(9)
  doc.setTextColor(150, 150, 150)
  doc.text(`تم إنشاء هذا التقرير من نظام النخبة - ${new Date().toLocaleDateString('ar-EG')}`, pageWidth / 2, yPosition, { align: 'center' })

  return doc
}

/**
 * Download PDF file
 */
export const downloadPDF = (doc, filename) => {
  doc.save(filename)
}

/**
 * Generate PDF from HTML element (for complex layouts)
 */
export const generatePDFFromHTML = async (element, filename) => {
  try {
    const canvas = await html2canvas(element, {
      scale: 2,
      useCORS: true,
      logging: false,
    })

    const imgData = canvas.toDataURL('image/png')
    const pdf = new jsPDF({
      orientation: canvas.width > canvas.height ? 'landscape' : 'portrait',
      unit: 'mm',
      format: 'A4',
    })

    const imgWidth = pdf.internal.pageSize.getWidth()
    const imgHeight = (canvas.height * imgWidth) / canvas.width
    pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, imgHeight)

    downloadPDF(pdf, filename)
  } catch (error) {
    console.error('Error generating PDF from HTML:', error)
    throw error
  }
}
