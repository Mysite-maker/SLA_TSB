import { Hono } from 'hono';

const app = new Hono();

// Helper to get Bangkok local date (YYYY-MM-DD)
function getBangkokDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}

// API: Get Employees
app.get('/api/employees', async (c) => {
  try {
    const { results } = await c.env.DB.prepare('SELECT * FROM employees ORDER BY id ASC').all();
    return c.json(results);
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

// API: Get Terminals
app.get('/api/terminals', async (c) => {
  try {
    const { results } = await c.env.DB.prepare('SELECT * FROM terminals ORDER BY name ASC').all();
    return c.json(results);
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

// API: Get Daily Reports (Supports range querying, employee, and status filtering)
app.get('/api/reports', async (c) => {
  try {
    const start = c.req.query('start') || c.req.query('date') || getBangkokDate();
    const end = c.req.query('end') || c.req.query('date') || getBangkokDate();
    const employeeId = c.req.query('employee_id');
    const status = c.req.query('status');
    
    let query = `
      SELECT dr.*, e.name as employee_name, e.nickname as employee_nickname, t.name as terminal_name
      FROM daily_reports dr
      JOIN employees e ON dr.employee_id = e.id
      JOIN terminals t ON dr.terminal_id = t.id
      WHERE date(dr.created_at) >= ? AND date(dr.created_at) <= ?
    `;
    
    const params = [start, end];
    if (employeeId) {
      query += ` AND dr.employee_id = ?`;
      params.push(parseInt(employeeId, 10));
    }
    if (status) {
      query += ` AND dr.status = ?`;
      params.push(status);
    }
    
    query += ` ORDER BY dr.created_at DESC`;
    
    const { results } = await c.env.DB.prepare(query).bind(...params).all();
    return c.json(results);
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

// API: Post new Daily Report
app.post('/api/reports', async (c) => {
  try {
    const body = await c.req.json();
    const { employee_id, terminal_id, work_details, pending_details, report_date } = body;

    if (!employee_id || !terminal_id) {
      return c.json({ error: 'กรุณากรอกข้อมูลพนักงาน และอู่รถให้ครบถ้วน' }, 400);
    }

    const nowBangkok = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Bangkok" }); // YYYY-MM-DD HH:mm:ss
    const timePart = nowBangkok.includes(' ') ? nowBangkok.split(' ')[1] : '00:00:00';
    const createdAt = report_date ? `${report_date} ${timePart}` : nowBangkok;
    
    const result = await c.env.DB.prepare(`
      INSERT INTO daily_reports (employee_id, terminal_id, work_details, pending_details, status, created_at)
      VALUES (?, ?, ?, ?, 'Todo', ?)
    `).bind(
      parseInt(employee_id, 10),
      parseInt(terminal_id, 10),
      work_details || '',
      pending_details || '',
      createdAt
    ).run();

    return c.json({ success: true, id: result.meta.last_row_id });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

// API: Update Report Status (PATCH)
app.patch('/api/reports/:id/status', async (c) => {
  try {
    const id = c.req.param('id');
    const { status } = await c.req.json();

    if (!['Todo', 'In Progress', 'Done'].includes(status)) {
      return c.json({ error: 'สถานะไม่ถูกต้อง' }, 400);
    }

    await c.env.DB.prepare(`
      UPDATE daily_reports 
      SET status = ? 
      WHERE id = ?
    `).bind(status, id).run();

    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

// API: Update Daily Report Details (PUT)
app.put('/api/reports/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    const { employee_id, terminal_id, work_details, pending_details, report_date } = body;

    if (!employee_id || !terminal_id) {
      return c.json({ error: 'กรุณากรอกข้อมูลพนักงาน และอู่รถให้ครบถ้วน' }, 400);
    }

    const existing = await c.env.DB.prepare('SELECT created_at FROM daily_reports WHERE id = ?').bind(id).first();
    if (!existing) {
      return c.json({ error: 'ไม่พบรายงานที่ต้องการแก้ไข' }, 404);
    }

    const existingCreatedAt = existing.created_at || '';
    const timePart = existingCreatedAt.includes(' ') ? existingCreatedAt.split(' ')[1] : '00:00:00';
    const newCreatedAt = report_date ? `${report_date} ${timePart}` : existingCreatedAt;

    await c.env.DB.prepare(`
      UPDATE daily_reports 
      SET employee_id = ?, terminal_id = ?, work_details = ?, pending_details = ?, created_at = ?
      WHERE id = ?
    `).bind(
      parseInt(employee_id, 10),
      parseInt(terminal_id, 10),
      work_details || '',
      pending_details || '',
      newCreatedAt,
      id
    ).run();

    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

// API: Delete Daily Report (DELETE)
app.delete('/api/reports/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await c.env.DB.prepare('SELECT id FROM daily_reports WHERE id = ?').bind(id).first();
    if (!existing) {
      return c.json({ error: 'ไม่พบรายงานที่ต้องการลบ' }, 404);
    }

    await c.env.DB.prepare('DELETE FROM daily_reports WHERE id = ?').bind(id).run();
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

// Serve frontend SPA
app.get('/', (c) => {
  const htmlContent = `
<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ระบบรายงานปฏิบัติงานประจำวัน | Daily Report & Kanban</title>
  <!-- Google Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@300;400;500;600;700&family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  
  <!-- Tailwind CSS CDN -->
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      corePlugins: {
        preflight: false,
      }
    }
  </script>
  
  <style>
    :root {
      --bg-primary: #070b13;
      --bg-secondary: #0f172a;
      --bg-card: #1e293b;
      --bg-card-hover: #293548;
      --text-primary: #f8fafc;
      --text-secondary: #94a3b8;
      --text-muted: #64748b;
      --accent-blue: #3b82f6;
      --accent-purple: #8b5cf6;
      --accent-emerald: #10b981;
      --accent-amber: #f59e0b;
      --accent-red: #ef4444;
      --border-color: rgba(255, 255, 255, 0.08);
      --glass-bg: rgba(15, 23, 42, 0.6);
      --glass-border: rgba(255, 255, 255, 0.05);
      --font-main: 'Outfit', 'Noto Sans Thai', sans-serif;
      --glow-blue: 0 0 20px rgba(59, 130, 246, 0.2);
      --glow-emerald: 0 0 20px rgba(16, 185, 129, 0.2);
      --glow-amber: 0 0 20px rgba(245, 158, 11, 0.2);
      --shadow-lg: 0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.3);
      --radius: 12px;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background-color: var(--bg-primary);
      color: var(--text-primary);
      font-family: var(--font-main);
      min-height: 100vh;
      overflow-x: hidden;
      background-image: 
        radial-gradient(circle at 10% 20%, rgba(59, 130, 246, 0.08) 0%, transparent 40%),
        radial-gradient(circle at 90% 80%, rgba(139, 92, 246, 0.08) 0%, transparent 40%);
    }

    header {
      background: var(--glass-bg);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--glass-border);
      padding: 1.25rem 2rem;
      position: sticky;
      top: 0;
      z-index: 100;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
    }

    .header-container {
      max-width: 1400px;
      margin: 0 auto;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 1rem;
    }

    .logo-section {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .logo-icon {
      width: 42px;
      height: 42px;
      background: linear-gradient(135deg, var(--accent-blue), var(--accent-purple));
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.5rem;
      font-weight: 800;
      color: white;
      box-shadow: var(--glow-blue);
    }

    .logo-text h1 {
      font-size: 1.25rem;
      font-weight: 700;
      background: linear-gradient(to right, #ffffff, #cbd5e1);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .logo-text p {
      font-size: 0.75rem;
      color: var(--text-secondary);
      letter-spacing: 0.5px;
    }

    /* Stats Overview */
    .header-stats {
      display: flex;
      align-items: center;
      gap: 1.5rem;
    }

    .stat-badge {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--glass-border);
      border-radius: 20px;
      padding: 0.4rem 1rem;
      font-size: 0.85rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .stat-badge.todo { border-color: rgba(148, 163, 184, 0.3); }
    .stat-badge.progress { border-color: rgba(245, 158, 11, 0.3); }
    .stat-badge.done { border-color: rgba(16, 185, 129, 0.3); }

    .stat-badge .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }
    .stat-badge.todo .dot { background-color: var(--text-secondary); }
    .stat-badge.progress .dot { background-color: var(--accent-amber); }
    .stat-badge.done .dot { background-color: var(--accent-emerald); }

    .stat-badge span.num {
      font-weight: 700;
    }

    .progress-track {
      width: 120px;
      height: 6px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 3px;
      overflow: hidden;
      position: relative;
    }

    .progress-fill {
      height: 100%;
      background: linear-gradient(to right, var(--accent-blue), var(--accent-emerald));
      width: 0%;
      transition: width 0.6s ease;
    }

    /* Tabs Navigation */
    .tabs-nav {
      display: flex;
      gap: 0.5rem;
      max-width: 1400px;
      margin: 1.5rem auto 0 auto;
      padding: 0 1.5rem;
      border-bottom: 1px solid var(--border-color);
    }

    .tab-btn {
      background: transparent;
      border: none;
      color: var(--text-secondary);
      font-family: var(--font-main);
      font-weight: 600;
      font-size: 0.95rem;
      padding: 0.75rem 1.25rem;
      cursor: pointer;
      border-bottom: 3px solid transparent;
      transition: all 0.3s ease;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      border-radius: 6px 6px 0 0;
    }

    .tab-btn:hover {
      color: var(--text-primary);
      background: rgba(255, 255, 255, 0.02);
    }

    .tab-btn.active {
      color: var(--accent-blue);
      border-bottom-color: var(--accent-blue);
      text-shadow: 0 0 10px rgba(59, 130, 246, 0.3);
      background: rgba(59, 130, 246, 0.04);
    }

    /* Tab Content Section wrapper */
    .tab-content {
      display: none;
      animation: fadeIn 0.3s ease;
    }

    .tab-content.active {
      display: block;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(5px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* Main Container for Kanban View */
    .kanban-view-container {
      max-width: 1400px;
      margin: 2rem auto;
      padding: 0 1.5rem;
      display: grid;
      grid-template-columns: 350px 1fr;
      gap: 2rem;
    }

    @media (max-width: 1024px) {
      .kanban-view-container {
        grid-template-columns: 1fr;
      }
    }

    /* Card Wrapper */
    .glass-panel {
      background: var(--glass-bg);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      padding: 1.75rem;
      box-shadow: var(--shadow-lg);
    }

    .panel-title {
      font-size: 1.15rem;
      font-weight: 600;
      margin-bottom: 1.25rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      border-bottom: 1px solid var(--border-color);
      padding-bottom: 0.75rem;
    }

    /* Forms */
    .form-group {
      margin-bottom: 1.25rem;
      position: relative;
    }

    .form-label {
      display: block;
      font-size: 0.85rem;
      font-weight: 500;
      color: var(--text-secondary);
      margin-bottom: 0.5rem;
    }

    /* Custom Custom Select Style */
    .custom-select-container {
      position: relative;
      width: 100%;
    }

    .select-trigger {
      width: 100%;
      padding: 0.75rem 1rem;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      color: var(--text-primary);
      font-family: var(--font-main);
      font-size: 0.9rem;
      text-align: left;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
      transition: all 0.3s ease;
    }

    .select-trigger:focus, .select-trigger.active {
      outline: none;
      border-color: var(--accent-blue);
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
      background: rgba(255, 255, 255, 0.05);
    }

    .select-trigger::after {
      content: '▼';
      font-size: 0.7rem;
      color: var(--text-secondary);
      transition: transform 0.3s ease;
    }

    .select-trigger.active::after {
      transform: rotate(180deg);
    }

    .dropdown-menu {
      position: absolute;
      top: calc(100% + 5px);
      left: 0;
      width: 100%;
      background: #151d30;
      border: 1px solid var(--glass-border);
      border-radius: 8px;
      box-shadow: var(--shadow-lg);
      z-index: 1000;
      display: none;
      flex-direction: column;
      max-height: 250px;
      overflow: hidden;
      animation: slideDown 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }

    @keyframes slideDown {
      from { transform: translateY(-10px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }

    .search-box-container {
      padding: 0.5rem;
      border-bottom: 1px solid var(--border-color);
    }

    .dropdown-search {
      width: 100%;
      padding: 0.5rem 0.75rem;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      color: var(--text-primary);
      font-family: var(--font-main);
      font-size: 0.85rem;
    }

    .dropdown-search:focus {
      outline: none;
      border-color: var(--accent-blue);
    }

    .options-list {
      overflow-y: auto;
      max-height: 180px;
      list-style: none;
    }

    .option-item {
      padding: 0.65rem 1rem;
      font-size: 0.85rem;
      cursor: pointer;
      transition: background 0.2s ease, color 0.2s ease;
      color: var(--text-secondary);
    }

    .option-item:hover, .option-item.selected {
      background: var(--accent-blue);
      color: white;
    }

    /* Textarea */
    textarea {
      width: 100%;
      padding: 0.75rem 1rem;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      color: var(--text-primary);
      font-family: var(--font-main);
      font-size: 0.9rem;
      resize: vertical;
      min-height: 80px;
      transition: all 0.3s ease;
    }

    textarea:focus {
      outline: none;
      border-color: var(--accent-blue);
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
      background: rgba(255, 255, 255, 0.05);
    }

    /* Form Buttons */
    .btn-submit {
      width: 100%;
      padding: 0.8rem 1.5rem;
      background: linear-gradient(135deg, var(--accent-blue), var(--accent-purple));
      border: none;
      border-radius: 8px;
      color: white;
      font-family: var(--font-main);
      font-weight: 600;
      font-size: 0.95rem;
      cursor: pointer;
      box-shadow: var(--glow-blue);
      transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 0.5rem;
    }

    .btn-submit:hover {
      transform: translateY(-2px);
      box-shadow: 0 0 25px rgba(59, 130, 246, 0.4);
      filter: brightness(1.1);
    }

    .btn-submit:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
      box-shadow: none;
    }

    .spinner {
      width: 18px;
      height: 18px;
      border: 2px solid rgba(255, 255, 255, 0.3);
      border-top-color: white;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      display: none;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* Kanban Container */
    .board-container {
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    /* Date and Actions Control Row */
    .control-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 1rem;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      padding: 0.75rem 1.25rem;
      border-radius: var(--radius);
    }

    .date-selector-group {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex-wrap: wrap;
    }

    .date-input {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--border-color);
      color: var(--text-primary);
      font-family: var(--font-main);
      padding: 0.4rem 0.8rem;
      border-radius: 6px;
      font-size: 0.9rem;
      cursor: pointer;
    }

    .date-input:focus {
      outline: none;
      border-color: var(--accent-blue);
    }

    .btn-today {
      background: rgba(59, 130, 246, 0.1);
      border: 1px solid rgba(59, 130, 246, 0.2);
      color: var(--accent-blue);
      padding: 0.4rem 0.9rem;
      border-radius: 6px;
      font-size: 0.85rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .btn-today:hover {
      background: var(--accent-blue);
      color: white;
    }

    /* Kanban Grid */
    .kanban-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1.5rem;
      align-items: start;
    }

    @media (max-width: 768px) {
      .kanban-grid {
        grid-template-columns: 1fr;
      }
    }

    .kanban-column {
      background: rgba(15, 23, 42, 0.4);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      min-height: 600px;
      display: flex;
      flex-direction: column;
      padding: 1.25rem;
      position: relative;
      transition: all 0.3s ease;
    }

    .kanban-column.todo-column { border-top: 3px solid var(--text-secondary); }
    .kanban-column.progress-column { border-top: 3px solid var(--accent-amber); }
    .kanban-column.done-column { border-top: 3px solid var(--accent-emerald); }

    .kanban-column.drag-over {
      background: rgba(59, 130, 246, 0.05);
      border-color: rgba(59, 130, 246, 0.3);
      box-shadow: inset 0 0 15px rgba(59, 130, 246, 0.1);
    }

    .column-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.25rem;
    }

    .column-title {
      font-size: 1rem;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .column-badge {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 0.15rem 0.6rem;
      font-size: 0.75rem;
      font-weight: 700;
      color: var(--text-secondary);
    }

    /* Kanban Cards */
    .cards-container {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      flex-grow: 1;
      min-height: 500px;
    }

    .report-card {
      background: var(--bg-card);
      border: 1px solid var(--glass-border);
      border-radius: 10px;
      padding: 1.25rem;
      cursor: grab;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
      transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
      position: relative;
      overflow: hidden;
    }

    .report-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 4px;
      height: 100%;
    }

    .todo-column .report-card::before { background-color: var(--text-secondary); }
    .progress-column .report-card::before { background-color: var(--accent-amber); }
    .done-column .report-card::before { background-color: var(--accent-emerald); }

    .report-card:hover {
      transform: translateY(-3px);
      border-color: rgba(255, 255, 255, 0.15);
      box-shadow: var(--shadow-lg);
      background: var(--bg-card-hover);
    }

    .report-card:active {
      cursor: grabbing;
    }

    .report-card.dragging {
      opacity: 0.4;
      transform: scale(0.95);
      border: 2px dashed var(--accent-blue);
    }

    .report-card.editing {
      border-color: var(--accent-blue);
      box-shadow: var(--glow-blue);
      background: var(--bg-card-hover);
    }

    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 0.75rem;
    }

    .worker-info h3 {
      font-size: 0.95rem;
      font-weight: 600;
      color: var(--text-primary);
    }

    .worker-info p {
      font-size: 0.75rem;
      color: var(--text-secondary);
    }

    .card-time {
      font-size: 0.7rem;
      color: var(--text-muted);
      font-weight: 500;
    }

    .terminal-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      background: rgba(59, 130, 246, 0.08);
      border: 1px solid rgba(59, 130, 246, 0.15);
      color: var(--accent-blue);
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
      margin-bottom: 0.75rem;
    }

    .report-sections {
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
      font-size: 0.85rem;
      line-height: 1.4;
    }

    .report-sec {
      background: rgba(0, 0, 0, 0.15);
      padding: 0.5rem 0.75rem;
      border-radius: 6px;
      border-left: 2px solid transparent;
    }

    .sec-work { border-left-color: var(--accent-blue); }
    .sec-pending { border-left-color: var(--accent-amber); }
    .sec-recommend { border-left-color: var(--accent-purple); }

    .sec-label {
      font-weight: 700;
      font-size: 0.75rem;
      color: var(--text-secondary);
      margin-bottom: 0.2rem;
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }

    .sec-text {
      color: #e2e8f0;
      white-space: pre-line;
      word-break: break-word;
    }

    .card-actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.4rem;
      margin-top: 0.75rem;
      border-top: 1px solid var(--border-color);
      padding-top: 0.5rem;
    }

    .btn-action-sm {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--border-color);
      color: var(--text-secondary);
      padding: 0.2rem 0.4rem;
      border-radius: 4px;
      font-size: 0.7rem;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .btn-action-sm:hover {
      background: rgba(255, 255, 255, 0.1);
      color: var(--text-primary);
    }

    .btn-action-sm.btn-next-step:hover {
      background: rgba(59, 130, 246, 0.1);
      border-color: rgba(59, 130, 246, 0.3);
      color: var(--accent-blue);
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: var(--text-muted);
      font-size: 0.85rem;
      padding: 3rem 1rem;
      text-align: center;
      border: 2px dashed rgba(255, 255, 255, 0.03);
      border-radius: 8px;
      margin-top: 2rem;
    }

    .empty-state-icon {
      font-size: 2rem;
      margin-bottom: 0.5rem;
      opacity: 0.5;
    }

    .saving-card-overlay {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(15, 23, 42, 0.7);
      backdrop-filter: blur(2px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10;
      border-radius: 10px;
    }

    .saving-spinner {
      width: 24px;
      height: 24px;
      border: 2.5px solid rgba(59, 130, 246, 0.2);
      border-top-color: var(--accent-blue);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    /* Toast Notification */
    .toast-container {
      position: fixed;
      bottom: 2rem;
      right: 2rem;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .toast {
      background: #1e293b;
      border-left: 4px solid var(--accent-blue);
      border-radius: 6px;
      box-shadow: var(--shadow-lg);
      padding: 0.85rem 1.5rem;
      color: var(--text-primary);
      font-size: 0.85rem;
      font-weight: 500;
      min-width: 280px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      animation: toastIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    }

    @keyframes toastIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }

    .toast.success { border-left-color: var(--accent-emerald); }
    .toast.error { border-left-color: var(--accent-red); }

    .toast-close {
      cursor: pointer;
      color: var(--text-muted);
      font-weight: bold;
      border: none;
      background: none;
    }
    .toast-close:hover { color: var(--text-primary); }

    /* Summary Section Styles */
    .summary-view-container {
      max-width: 1400px;
      margin: 2rem auto;
      padding: 0 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    .summary-controls {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 1rem;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      padding: 0.85rem 1.5rem;
      border-radius: var(--radius);
    }

    .preset-btns-group {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
    }

    .btn-preset {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--border-color);
      color: var(--text-secondary);
      padding: 0.4rem 0.9rem;
      border-radius: 6px;
      font-size: 0.85rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .btn-preset:hover {
      background: rgba(255, 255, 255, 0.1);
      color: var(--text-primary);
    }

    .btn-preset.active {
      background: var(--accent-blue);
      color: white;
      border-color: var(--accent-blue);
    }

    .btn-export-excel {
      background: linear-gradient(135deg, var(--accent-emerald), #059669);
      border: none;
      color: white;
      padding: 0.5rem 1.25rem;
      border-radius: 6px;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      box-shadow: var(--glow-emerald);
      transition: all 0.3s ease;
    }

    .btn-export-excel:hover {
      transform: translateY(-1px);
      box-shadow: 0 0 20px rgba(16, 185, 129, 0.4);
      filter: brightness(1.1);
    }

    /* Summary Stats Grid */
    .summary-stats-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1.5rem;
    }

    @media (max-width: 768px) {
      .summary-stats-grid {
        grid-template-columns: 1fr;
      }
    }

    .stat-card {
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      padding: 1.25rem 1.5rem;
      box-shadow: var(--shadow-lg);
      display: flex;
      align-items: center;
      gap: 1.25rem;
    }

    .stat-card-icon {
      font-size: 2rem;
      width: 50px;
      height: 50px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--border-color);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .stat-card-details {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .stat-card-label {
      font-size: 0.8rem;
      color: var(--text-secondary);
      font-weight: 500;
    }

    .stat-card-value {
      font-size: 1.75rem;
      font-weight: 700;
    }

    .stat-card.blue .stat-card-icon { color: var(--accent-blue); background: rgba(59, 130, 246, 0.06); }
    .stat-card.amber .stat-card-icon { color: var(--accent-amber); background: rgba(245, 158, 11, 0.06); }
    .stat-card.emerald .stat-card-icon { color: var(--accent-emerald); background: rgba(16, 185, 129, 0.06); }

    /* Summary Data Table */
    .table-wrapper {
      overflow-x: auto;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      box-shadow: var(--shadow-lg);
    }

    .summary-table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 0.88rem;
    }

    .summary-table th {
      background: rgba(255, 255, 255, 0.02);
      border-bottom: 1px solid var(--border-color);
      padding: 1rem 1.25rem;
      font-weight: 600;
      color: var(--text-secondary);
      white-space: nowrap;
    }

    .summary-table td {
      padding: 1rem 1.25rem;
      border-bottom: 1px solid var(--border-color);
      color: #e2e8f0;
      vertical-align: top;
      line-height: 1.5;
    }

    .summary-table tr:hover {
      background: rgba(255, 255, 255, 0.01);
    }

    .badge-status {
      display: inline-block;
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 700;
      text-align: center;
      white-space: nowrap;
    }

    .badge-status.todo {
      background: rgba(148, 163, 184, 0.1);
      color: var(--text-secondary);
      border: 1px solid rgba(148, 163, 184, 0.2);
    }

    .badge-status.progress {
      background: rgba(245, 158, 11, 0.1);
      color: var(--accent-amber);
      border: 1px solid rgba(245, 158, 11, 0.2);
    }

    .badge-status.done {
      background: rgba(16, 185, 129, 0.1);
      color: var(--accent-emerald);
      border: 1px solid rgba(16, 185, 129, 0.2);
    }
  </style>
</head>
<body>

  <header>
    <div class="header-container flex flex-col md:flex-row justify-between items-center gap-4">
      <div class="logo-section flex items-center gap-3 w-full md:w-auto justify-center md:justify-start">
        <div class="logo-icon">📝</div>
        <div class="logo-text">
          <h1>ระบบรายงานปฏิบัติงานประจำวัน</h1>
          <p>DAILY WORK LOG & KANBAN MANAGEMENT</p>
        </div>
      </div>
      <div class="header-stats flex flex-wrap justify-center md:justify-end items-center gap-4 w-full md:w-auto">
        <div class="stat-badge todo">
          <div class="dot"></div>
          <span>Todo:</span>
          <span class="num" id="stat-todo-count">0</span>
        </div>
        <div class="stat-badge progress">
          <div class="dot"></div>
          <span>In Progress:</span>
          <span class="num" id="stat-progress-count">0</span>
        </div>
        <div class="stat-badge done">
          <div class="dot"></div>
          <span>Done:</span>
          <span class="num" id="stat-done-count">0</span>
        </div>
        <div class="flex flex-col items-center md:items-end">
          <div style="font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 2px; text-align: right;">
            ความคืบหน้า: <span id="stat-percent">0%</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill" id="stat-progress-bar"></div>
          </div>
        </div>
      </div>
    </div>
  </header>

  <!-- Navigation tabs -->
  <div class="tabs-nav">
    <button class="tab-btn active" data-tab="kanban">📋 บอร์ดปฏิบัติการ (Kanban Board)</button>
    <button class="tab-btn" data-tab="summary">📊 รายงานสรุป (Summary Reports)</button>
  </div>

  <!-- TAB CONTENT 1: Kanban Operation -->
  <div id="tab-content-kanban" class="tab-content active">
    <main class="kanban-view-container">
      <!-- Left panel: Data Entry Form -->
      <section>
        <div class="glass-panel">
          <div class="panel-title">
            <span>✍️</span> บันทึกรายงานประจำวัน
          </div>
          
          <form id="report-form">
            <!-- Employee Selection -->
            <div class="form-group">
              <label class="form-label">ชื่อผู้รายงาน (พนักงาน)</label>
              <div class="custom-select-container" id="employee-select-container">
                <button type="button" class="select-trigger" id="employee-trigger">เลือกพนักงาน...</button>
                <input type="hidden" name="employee_id" id="employee-hidden-input">
                <div class="dropdown-menu" id="employee-dropdown">
                  <div class="search-box-container">
                    <input type="text" class="dropdown-search" placeholder="ค้นหาชื่อ..." id="employee-search">
                  </div>
                  <ul class="options-list" id="employee-options">
                    <!-- JS Dynamic load -->
                  </ul>
                </div>
              </div>
            </div>

            <!-- Terminal Selection -->
            <div class="form-group">
              <label class="form-label">สถานที่ปฏิบัติงาน (อู่รถ)</label>
              <div class="custom-select-container" id="terminal-select-container">
                <button type="button" class="select-trigger" id="terminal-trigger">เลือกอู่รถ...</button>
                <input type="hidden" name="terminal_id" id="terminal-hidden-input">
                <div class="dropdown-menu" id="terminal-dropdown">
                  <div class="search-box-container">
                    <input type="text" class="dropdown-search" placeholder="ค้นหาอู่รถ..." id="terminal-search">
                  </div>
                  <ul class="options-list" id="terminal-options">
                    <!-- JS Dynamic load -->
                  </ul>
                </div>
              </div>
            </div>

            <!-- Work details -->
            <div class="form-group">
              <label class="form-label">ทำงานอะไรบ้าง (สิ่งที่ปฏิบัติแล้ว)</label>
              <textarea name="work_details" id="work-details" placeholder="อธิบายรายละเอียดการปฏิบัติงานประจำวันนี้..."></textarea>
            </div>

            <!-- Pending details -->
            <div class="form-group">
              <label class="form-label">มีอะไรที่ยังค้างอยู่ (สิ่งที่ต้องดำเนินการต่อ)</label>
              <textarea name="pending_details" id="pending-details" placeholder="ระบุงานที่ยังค้างคา หรือต้องการทำต่อ..."></textarea>
            </div>



            <!-- Submit Button & Cancel Button -->
            <div class="flex flex-col gap-2">
              <button type="submit" class="btn-submit" id="btn-submit">
                <span class="spinner" id="submit-spinner"></span>
                <span id="submit-text">ส่งรายงานปฏิบัติงาน</span>
              </button>
              <button type="button" class="btn-preset" id="btn-cancel-edit" style="display: none; width: 100%; padding: 0.6rem; border-color: var(--accent-red); color: var(--accent-red); background: rgba(239, 68, 68, 0.05); font-weight: 600;">
                ❌ ยกเลิกการแก้ไข
              </button>
              <button type="button" class="btn-preset" id="btn-delete-report" style="display: none; width: 100%; padding: 0.6rem; border-color: var(--accent-red); color: white; background: linear-gradient(135deg, var(--accent-red), #dc2626); font-weight: 600; margin-top: 0.25rem;">
                🗑️ ลบข้อมูล
              </button>
            </div>
          </form>
        </div>
      </section>

      <!-- Right panel: Kanban Board -->
      <section class="board-container">
        <!-- Date Selector bar -->
        <div class="control-row flex flex-col md:flex-row md:justify-between md:items-center gap-3">
          <div class="date-selector-group flex flex-row items-center gap-2 w-full md:w-auto">
            <label class="form-label" style="margin-bottom: 0; white-space: nowrap;">📅 ประจำวันที่:</label>
            <input type="date" class="date-input flex-1 md:flex-initial" id="report-date-picker">
            <button class="btn-today" id="btn-reset-today">วันนี้</button>
          </div>
          <div style="font-size: 0.85rem; color: var(--text-secondary);" class="text-center md:text-right">
            <span style="font-size: 1rem; vertical-align: middle;">💡</span> <em>ลากการ์ดงาน (Drag & Drop) เพื่อสลับช่องสถานะงาน</em>
          </div>
        </div>

        <!-- Kanban Grid -->
        <div class="kanban-grid">
          
          <!-- Column: Todo -->
          <div class="kanban-column todo-column" data-status="Todo" id="col-todo">
            <div class="column-header">
              <div class="column-title">
                <span>📋</span> รอดำเนินการ (Todo)
              </div>
              <div class="column-badge" id="badge-todo">0</div>
            </div>
            <div class="cards-container" id="container-todo">
              <!-- Dynamic Cards -->
            </div>
          </div>

          <!-- Column: In Progress -->
          <div class="kanban-column progress-column" data-status="In Progress" id="col-progress">
            <div class="column-header">
              <div class="column-title">
                <span>⚡</span> กำลังดำเนินงาน (In Progress)
              </div>
              <div class="column-badge" id="badge-progress">0</div>
            </div>
            <div class="cards-container" id="container-progress">
              <!-- Dynamic Cards -->
            </div>
          </div>

          <!-- Column: Done -->
          <div class="kanban-column done-column" data-status="Done" id="col-done">
            <div class="column-header">
              <div class="column-title">
                <span>✅</span> เสร็จสิ้น (Done)
              </div>
              <div class="column-badge" id="badge-done">0</div>
            </div>
            <div class="cards-container" id="container-done">
              <!-- Dynamic Cards -->
            </div>
          </div>

        </div>
      </section>
    </main>
  </div>

  <!-- TAB CONTENT 2: Summary reports & Export -->
  <div id="tab-content-summary" class="tab-content">
    <div class="summary-view-container">
      
      <!-- Date Range Controls -->
      <div class="summary-controls flex flex-col lg:flex-row lg:justify-between lg:items-center gap-4">
        <div class="date-selector-group flex flex-col sm:flex-row sm:items-center flex-wrap gap-3 w-full lg:w-auto">
          <div class="flex items-center gap-2 w-full sm:w-auto">
            <label class="form-label" style="margin-bottom: 0; white-space: nowrap;">📅 ตั้งแต่วันที่:</label>
            <input type="date" class="date-input w-full sm:w-auto" id="summary-start-date">
          </div>
          <div class="flex items-center gap-2 w-full sm:w-auto">
            <label class="form-label" style="margin-bottom: 0; white-space: nowrap;">ถึงวันที่:</label>
            <input type="date" class="date-input w-full sm:w-auto" id="summary-end-date">
          </div>
          <div class="flex items-center gap-2 w-full sm:w-auto">
            <label class="form-label" style="margin-bottom: 0; white-space: nowrap;">พนักงาน:</label>
            <select class="date-input w-full sm:w-auto" id="summary-employee-filter" style="background: rgba(255, 255, 255, 0.05); color: var(--text-primary); outline: none;">
              <option value="" style="background-color: var(--bg-card); color: var(--text-primary);">พนักงานทั้งหมด</option>
            </select>
          </div>
          <div class="flex items-center gap-2 w-full sm:w-auto">
            <label class="form-label" style="margin-bottom: 0; white-space: nowrap;">สถานะ:</label>
            <select class="date-input w-full sm:w-auto" id="summary-status-filter" style="background: rgba(255, 255, 255, 0.05); color: var(--text-primary); outline: none;">
              <option value="" style="background-color: var(--bg-card); color: var(--text-primary);">สถานะทั้งหมด</option>
              <option value="Todo" style="background-color: var(--bg-card); color: var(--text-primary);">Todo</option>
              <option value="In Progress" style="background-color: var(--bg-card); color: var(--text-primary);">In Progress</option>
              <option value="Done" style="background-color: var(--bg-card); color: var(--text-primary);">Done</option>
            </select>
          </div>
          <button class="btn-today w-full sm:w-auto mt-2 sm:mt-0" id="btn-search-summary">ดึงข้อมูล</button>
        </div>
        
        <div class="preset-btns-group flex justify-between lg:justify-start w-full lg:w-auto gap-2">

          <button class="btn-export-excel flex-1 lg:flex-initial" id="btn-export-excel">
            <span>📥</span> ดาวน์โหลด Excel
          </button>
        </div>
      </div>

      <!-- Summary KPI stats -->
      <div class="summary-stats-grid">
        
        <div class="stat-card blue">
          <div class="stat-card-icon">📂</div>
          <div class="stat-card-details">
            <span class="stat-card-label">จำนวนรายงานทั้งหมด</span>
            <span class="stat-card-value" id="kpi-total-reports">0</span>
          </div>
        </div>

        <div class="stat-card amber">
          <div class="stat-card-icon">⏳</div>
          <div class="stat-card-details">
            <span class="stat-card-label">งานค้างรอการแก้ไข</span>
            <span class="stat-card-value" id="kpi-pending-reports">0</span>
          </div>
        </div>

        <div class="stat-card emerald">
          <div class="stat-card-icon">🎯</div>
          <div class="stat-card-details">
            <span class="stat-card-label">อัตรางานเสร็จสิ้น (Done Rate)</span>
            <span class="stat-card-value" id="kpi-done-percent">0%</span>
          </div>
        </div>

      </div>

      <!-- Data Table -->
      <div class="table-wrapper">
        <table class="summary-table" id="summary-data-table">
          <thead>
            <tr>
              <th style="width: 120px;">วันที่รายงาน</th>
              <th style="width: 180px;">พนักงาน</th>
              <th style="width: 160px;">สถานที่ (อู่รถ)</th>
              <th>รายละเอียดการทำงาน (ทำงานอะไรบ้าง)</th>
              <th>งานค้าง (มีอะไรที่ยังค้างอยู่)</th>

              <th style="width: 120px; text-align: center;">สถานะ</th>
            </tr>
          </thead>
          <tbody id="summary-table-body">
            <!-- Dynamic summary table rows -->
          </tbody>
        </table>
      </div>

    </div>
  </div>

  <div class="toast-container" id="toast-container"></div>

  <script>
    // State
    let employees = [];
    let terminals = [];
    let reports = []; // Kanban current reports
    let summaryReports = []; // Summary tab reports
    let draggedCardId = null;
    let editingReportId = null;

    // Toast function
    function showToast(message, type = 'success') {
      const container = document.getElementById('toast-container');
      const toast = document.createElement('div');
      toast.className = \`toast \${type}\`;
      toast.innerHTML = \`
        <span>\${message}</span>
        <button class="toast-close" onclick="this.parentElement.remove()">×</button>
      \`;
      container.appendChild(toast);
      
      // Auto remove
      setTimeout(() => {
        toast.style.animation = 'toastIn 0.3s reverse';
        setTimeout(() => toast.remove(), 300);
      }, 4000);
    }

    // Custom Search Dropdown Component
    function initCustomDropdown(containerId, data, onSelectCallback) {
      const container = document.getElementById(containerId);
      const trigger = container.querySelector('.select-trigger');
      const dropdown = container.querySelector('.dropdown-menu');
      const search = container.querySelector('.dropdown-search');
      const optionsList = container.querySelector('.options-list');
      const hiddenInput = container.querySelector('input[type="hidden"]');

      // Toggle dropdown
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        closeAllDropdowns();
        trigger.classList.toggle('active');
        dropdown.style.display = trigger.classList.contains('active') ? 'flex' : 'none';
        if (trigger.classList.contains('active')) {
          search.focus();
        }
      });

      // Filter options on keyup
      search.addEventListener('input', () => {
        const query = search.value.toLowerCase().trim();
        const items = optionsList.querySelectorAll('.option-item');
        items.forEach(item => {
          const text = item.textContent.toLowerCase();
          if (text.includes(query)) {
            item.style.display = 'block';
          } else {
            item.style.display = 'none';
          }
        });
      });

      // Populate list
      function populateOptions(items) {
        optionsList.innerHTML = '';
        items.forEach(item => {
          const li = document.createElement('li');
          li.className = 'option-item';
          li.dataset.value = item.id;
          li.textContent = item.nickname ? \`\${item.name} (\${item.nickname})\` : item.name;
          
          li.addEventListener('click', (e) => {
            e.stopPropagation();
            hiddenInput.value = item.id;
            trigger.textContent = li.textContent;
            trigger.classList.remove('active');
            dropdown.style.display = 'none';
            search.value = '';
            
            // Mark selected
            optionsList.querySelectorAll('.option-item').forEach(el => el.classList.remove('selected'));
            li.classList.add('selected');

            if (onSelectCallback) onSelectCallback(item);
          });
          
          optionsList.appendChild(li);
        });
      }

      populateOptions(data);

      return {
        updateData: (newData) => {
          populateOptions(newData);
        },
        reset: () => {
          hiddenInput.value = '';
          trigger.textContent = trigger.dataset.placeholder || 'กรุณาเลือก...';
          search.value = '';
          optionsList.querySelectorAll('.option-item').forEach(el => el.classList.remove('selected'));
        },
        setValue: (id) => {
          const item = data.find(d => d.id == id);
          if (item) {
            hiddenInput.value = item.id;
            const text = item.nickname ? \`\${item.name} (\${item.nickname})\` : item.name;
            trigger.textContent = text;
            optionsList.querySelectorAll('.option-item').forEach(el => {
              if (el.dataset.value == id) {
                el.classList.add('selected');
              } else {
                el.classList.remove('selected');
              }
            });
          } else {
            hiddenInput.value = '';
            trigger.textContent = trigger.dataset.placeholder || 'กรุณาเลือก...';
            optionsList.querySelectorAll('.option-item').forEach(el => el.classList.remove('selected'));
          }
        }
      };
    }

    function closeAllDropdowns() {
      document.querySelectorAll('.select-trigger').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.dropdown-menu').forEach(el => el.style.display = 'none');
    }

    document.addEventListener('click', closeAllDropdowns);

    // Initial setup for dates
    const datePicker = document.getElementById('report-date-picker');
    const bangkokToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    
    // Set default date picker to Thailand current date (YYYY-MM-DD)
    datePicker.value = bangkokToday;

    // Set default summary date range (current month: 1st of month to today)
    const summaryStartDateInput = document.getElementById('summary-start-date');
    const summaryEndDateInput = document.getElementById('summary-end-date');
    summaryStartDateInput.value = bangkokToday.substring(0, 8) + '01';
    summaryEndDateInput.value = bangkokToday;

    let employeeDropdownControl, terminalDropdownControl;

    // Load initial data
    async function loadInitialData() {
      try {
        const [empRes, termRes] = await Promise.all([
          fetch('/api/employees'),
          fetch('/api/terminals')
        ]);
        
        employees = await empRes.json();
        terminals = await termRes.json();

        // Populate summary employee filter
        const empFilter = document.getElementById('summary-employee-filter');
        empFilter.innerHTML = '<option value="" style="background-color: var(--bg-card); color: var(--text-primary);">พนักงานทั้งหมด</option>';
        employees.forEach(emp => {
          const opt = document.createElement('option');
          opt.value = emp.id;
          opt.textContent = emp.nickname ? emp.name + ' (' + emp.nickname + ')' : emp.name;
          opt.style.backgroundColor = 'var(--bg-card)';
          opt.style.color = 'var(--text-primary)';
          empFilter.appendChild(opt);
        });

        // Initialize Custom Dropdowns
        document.getElementById('employee-trigger').dataset.placeholder = 'เลือกพนักงาน...';
        employeeDropdownControl = initCustomDropdown('employee-select-container', employees);

        document.getElementById('terminal-trigger').dataset.placeholder = 'เลือกสถานที่ปฏิบัติงาน (อู่รถ)...';
        terminalDropdownControl = initCustomDropdown('terminal-select-container', terminals);

        // Load daily reports
        await fetchReports();
      } catch (err) {
        showToast('ไม่สามารถดึงข้อมูลพื้นฐานจากระบบได้: ' + err.message, 'error');
      }
    }

    // Fetch reports for current date (Kanban)
    async function fetchReports() {
      const selectedDate = datePicker.value;
      try {
        const res = await fetch(\`/api/reports?date=\${selectedDate}\`);
        reports = await res.json();
        renderKanban();
        updateHeaderStats();
      } catch (err) {
        showToast('ไม่สามารถดึงข้อมูลใบงานได้: ' + err.message, 'error');
      }
    }

    // Fetch summary reports for range
    async function fetchSummaryReports() {
      const start = summaryStartDateInput.value;
      const end = summaryEndDateInput.value;
      const empId = document.getElementById('summary-employee-filter').value;
      const status = document.getElementById('summary-status-filter').value;
      if (!start || !end) {
        showToast('กรุณาระบุช่วงวันที่ให้ครบถ้วน', 'error');
        return;
      }
      try {
        let url = '/api/reports?start=' + start + '&end=' + end;
        if (empId) {
          url += '&employee_id=' + empId;
        }
        if (status) {
          url += '&status=' + status;
        }
        const res = await fetch(url);
        summaryReports = await res.json();

        // Sort: date ascending, then employee name ascending
        summaryReports.sort((a, b) => {
          const dateA = a.created_at || '';
          const dateB = b.created_at || '';
          if (dateA !== dateB) {
            return dateA.localeCompare(dateB);
          }
          const nameA = a.employee_name || '';
          const nameB = b.employee_name || '';
          return nameA.localeCompare(nameB, 'th');
        });

        renderSummaryTable();
        updateSummaryKPIs();
        updateHeaderStats();
      } catch (err) {
        showToast('ไม่สามารถดึงข้อมูลสรุปได้: ' + err.message, 'error');
      }
    }

    // Render Kanban Cards
    function renderKanban() {
      const containers = {
        'Todo': document.getElementById('container-todo'),
        'In Progress': document.getElementById('container-progress'),
        'Done': document.getElementById('container-done')
      };

      // Clear containers
      Object.values(containers).forEach(c => c.innerHTML = '');

      // Group counts
      const counts = { 'Todo': 0, 'In Progress': 0, 'Done': 0 };

      reports.forEach(report => {
        const container = containers[report.status];
        if (!container) return;
        
        counts[report.status]++;

        let timeStr = '';
        if (report.created_at) {
          const parts = report.created_at.split(' ');
          if (parts.length > 1) {
            timeStr = parts[1].substring(0, 5) + ' น.';
          }
        }

        const card = document.createElement('div');
        card.className = 'report-card';
        card.draggable = true;
        card.dataset.id = report.id;

        const pendingHtml = report.pending_details ? \`
          <div class="report-sec sec-pending">
            <div class="sec-label">⏳ งานค้าง:</div>
            <div class="sec-text">\${escapeHtml(report.pending_details)}</div>
          </div>
        \` : '';

        const workHtml = (report.work_details && report.work_details.trim()) ? \`
          <div class="report-sec sec-work">
            <div class="sec-label">🔧 งานที่ทำ:</div>
            <div class="sec-text">\${escapeHtml(report.work_details)}</div>
          </div>
        \` : '';

        card.innerHTML = \`
          <div class="card-header">
            <div class="worker-info">
              <h3>\${escapeHtml(report.employee_name)}</h3>
              <p>\${report.employee_nickname ? \`(\${escapeHtml(report.employee_nickname)})\` : ''}</p>
            </div>
            <div class="card-time">\${timeStr}</div>
          </div>
          <div class="terminal-badge">📍 \${escapeHtml(report.terminal_name)}</div>
          <div class="report-sections">
            \${workHtml}
            \${pendingHtml}
          </div>
          <div class="card-actions">
            \${report.status !== 'Todo' ? \`<button class="btn-action-sm" onclick="moveCardStep(\${report.id}, 'prev')">◀ ย้อนกลับ</button>\` : ''}
            \${report.status !== 'Done' ? \`<button class="btn-action-sm btn-next-step" onclick="moveCardStep(\${report.id}, 'next')">ถัดไป ▶</button>\` : ''}
          </div>
        \`;

        card.addEventListener('dragstart', () => {
          card.classList.add('dragging');
          draggedCardId = report.id;
        });

        card.addEventListener('dragend', () => {
          card.classList.remove('dragging');
          draggedCardId = null;
        });

        // Click card body to enter edit mode (not action buttons)
        card.addEventListener('click', (e) => {
          if (e.target.closest('.btn-action-sm')) return;
          startEditReport(report);
        });

        container.appendChild(card);
      });

      // Update badges
      document.getElementById('badge-todo').textContent = counts['Todo'];
      document.getElementById('badge-progress').textContent = counts['In Progress'];
      document.getElementById('badge-done').textContent = counts['Done'];

      // Show empty states
      Object.entries(containers).forEach(([status, container]) => {
        if (container.children.length === 0) {
          container.innerHTML = \`
            <div class="empty-state">
              <div class="empty-state-icon">📭</div>
              <div>ไม่มีรายงานสถานะนี้</div>
            </div>
          \`;
        }
      });
    }

    // Stats calculations (Updates dynamically based on active tab: Kanban vs Summary)
    function updateHeaderStats() {
      const activeTabBtn = document.querySelector('.tab-btn.active');
      const activeTab = activeTabBtn ? activeTabBtn.dataset.tab : 'kanban';
      
      const currentList = activeTab === 'summary' ? summaryReports : reports;
      
      const todo = currentList.filter(r => r.status === 'Todo').length;
      const progress = currentList.filter(r => r.status === 'In Progress').length;
      const done = currentList.filter(r => r.status === 'Done').length;
      const total = currentList.length;

      document.getElementById('stat-todo-count').textContent = todo;
      document.getElementById('stat-progress-count').textContent = progress;
      document.getElementById('stat-done-count').textContent = done;

      const percent = total > 0 ? Math.round((done / total) * 100) : 0;
      document.getElementById('stat-percent').textContent = percent + '%';
      document.getElementById('stat-progress-bar').style.width = percent + '%';
    }

    // Render Summary Table Rows
    function renderSummaryTable() {
      const tbody = document.getElementById('summary-table-body');
      tbody.innerHTML = '';

      if (summaryReports.length === 0) {
        tbody.innerHTML = \`
          <tr>
            <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 3rem 0;">
              <div style="font-size: 2rem; margin-bottom: 0.5rem;">📭</div>
              ไม่พบรายงานปฏิบัติงานในช่วงวันที่เลือก
            </td>
          </tr>
        \`;
        return;
      }

      summaryReports.forEach(report => {
        const tr = document.createElement('tr');
        
        let statusClass = 'todo';
        let statusText = 'Todo';
        if (report.status === 'In Progress') {
          statusClass = 'progress';
          statusText = 'In Progress';
        } else if (report.status === 'Done') {
          statusClass = 'done';
          statusText = 'Done';
        }

        // Extract date from created_at
        const dateStr = report.created_at ? report.created_at.split(' ')[0] : '';
        const timeStr = report.created_at && report.created_at.split(' ').length > 1 ? report.created_at.split(' ')[1].substring(0,5) : '';

        tr.innerHTML = \`
          <td style="font-weight: 500;">
            \${dateStr}<br>
            <span style="font-size: 0.75rem; color: var(--text-muted);">\${timeStr} น.</span>
          </td>
          <td>
            <strong>\${escapeHtml(report.employee_name)}</strong><br>
            <span style="font-size: 0.75rem; color: var(--text-secondary);">\${report.employee_nickname ? \`(\${escapeHtml(report.employee_nickname)})\` : ''}</span>
          </td>
          <td>
            <span style="color: var(--accent-blue);">📍 \${escapeHtml(report.terminal_name)}</span>
          </td>
          <td><div class="sec-text" style="font-size: 0.85rem;">\${escapeHtml(report.work_details)}</div></td>
          <td><div class="sec-text" style="font-size: 0.85rem; color: var(--accent-amber);">\${escapeHtml(report.pending_details) || '-'}</div></td>
          <td style="text-align: center;">
            <span class="badge-status \${statusClass}">\${statusText}</span>
          </td>
        \`;
        
        tbody.appendChild(tr);
      });
    }

    // Update summary dashboard metrics
    function updateSummaryKPIs() {
      const total = summaryReports.length;
      const done = summaryReports.filter(r => r.status === 'Done').length;
      const pending = summaryReports.filter(r => r.pending_details && r.pending_details.trim() !== '').length;

      document.getElementById('kpi-total-reports').textContent = total;
      document.getElementById('kpi-pending-reports').textContent = pending;

      const percent = total > 0 ? Math.round((done / total) * 100) : 0;
      document.getElementById('kpi-done-percent').textContent = percent + '%';
    }

    // HTML Escape Helper
    function escapeHtml(text) {
      if (!text) return '';
      const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
      };
      return text.replace(/[&<>"']/g, function(m) { return map[m]; });
    }

    // Move step from button (touch friendly)
    function moveCardStep(reportId, direction) {
      const report = reports.find(r => r.id === reportId);
      if (!report) return;

      let newStatus = '';
      if (direction === 'next') {
        if (report.status === 'Todo') newStatus = 'In Progress';
        else if (report.status === 'In Progress') newStatus = 'Done';
      } else {
        if (report.status === 'Done') newStatus = 'In Progress';
        else if (report.status === 'In Progress') newStatus = 'Todo';
      }

      if (newStatus) {
        updateCardStatus(reportId, newStatus);
      }
    }

    // Drag and Drop implementation
    document.querySelectorAll('.kanban-column').forEach(column => {
      column.addEventListener('dragover', (e) => {
        e.preventDefault();
        column.classList.add('drag-over');
      });

      column.addEventListener('dragleave', () => {
        column.classList.remove('drag-over');
      });

      column.addEventListener('drop', (e) => {
        e.preventDefault();
        column.classList.remove('drag-over');
        const targetStatus = column.dataset.status;
        
        if (draggedCardId) {
          const report = reports.find(r => r.id === draggedCardId);
          if (report && report.status !== targetStatus) {
            updateCardStatus(draggedCardId, targetStatus);
          }
        }
      });
    });

    // API: Update Card Status
    async function updateCardStatus(id, newStatus) {
      const cardEl = document.querySelector(\`[data-id="\${id}"]\`);
      let overlay = null;
      if (cardEl) {
        overlay = document.createElement('div');
        overlay.className = 'saving-card-overlay';
        overlay.innerHTML = '<div class="saving-spinner"></div>';
        cardEl.style.position = 'relative';
        cardEl.appendChild(overlay);
      }

      try {
        const res = await fetch(\`/api/reports/\${id}/status\`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus })
        });
        
        if (!res.ok) throw new Error('การบันทึกขัดข้อง');

        const report = reports.find(r => r.id === id);
        if (report) {
          report.status = newStatus;
        }
        
        showToast('อัปเดตสถานะสำเร็จ', 'success');
      } catch (err) {
        showToast('ไม่สามารถอัปเดตสถานะได้: ' + err.message, 'error');
      } finally {
        if (overlay) overlay.remove();
        renderKanban();
        updateHeaderStats();
      }
    }

    // ---- Edit Mode Functions ----
    function startEditReport(report) {
      // If clicking the same card again, cancel edit
      if (editingReportId === report.id) {
        cancelEdit();
        return;
      }

      // Remove editing highlight from any previous card
      document.querySelectorAll('.report-card.editing').forEach(el => el.classList.remove('editing'));

      // Set editing state
      editingReportId = report.id;

      // Highlight the selected card
      const cardEl = document.querySelector(\`[data-id="\${report.id}"]\`);
      if (cardEl) cardEl.classList.add('editing');

      // Populate dropdowns
      employeeDropdownControl.setValue(report.employee_id);
      terminalDropdownControl.setValue(report.terminal_id);

      // Populate text fields
      document.getElementById('work-details').value = report.work_details || '';
      document.getElementById('pending-details').value = report.pending_details || '';

      // Set the date from created_at
      const reportDate = report.created_at ? report.created_at.split(' ')[0] : bangkokToday;
      document.getElementById('report-date-picker').value = reportDate;

      // Update submit button
      document.getElementById('submit-text').textContent = '💾 บันทึกการแก้ไข';
      document.getElementById('btn-submit').style.background = 'linear-gradient(135deg, var(--accent-amber), #d97706)';

      // Show cancel button
      document.getElementById('btn-cancel-edit').style.display = 'block';
      document.getElementById('btn-delete-report').style.display = 'block';

      // Scroll form into view on mobile
      document.querySelector('.glass-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function cancelEdit() {
      // Clear state
      editingReportId = null;

      // Remove editing highlight
      document.querySelectorAll('.report-card.editing').forEach(el => el.classList.remove('editing'));

      // Reset form
      document.getElementById('work-details').value = '';
      document.getElementById('pending-details').value = '';

      // Reset dropdowns
      employeeDropdownControl.reset();
      terminalDropdownControl.reset();

      // Restore submit button
      document.getElementById('submit-text').textContent = 'ส่งรายงานปฏิบัติงาน';
      document.getElementById('btn-submit').style.background = '';

      // Hide cancel button
      document.getElementById('btn-cancel-edit').style.display = 'none';
      document.getElementById('btn-delete-report').style.display = 'none';
    }

    // Form Submit Handler
    const form = document.getElementById('report-form');
    const btnSubmit = document.getElementById('btn-submit');
    const submitSpinner = document.getElementById('submit-spinner');
    const submitText = document.getElementById('submit-text');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const employee_id = document.getElementById('employee-hidden-input').value;
      const terminal_id = document.getElementById('terminal-hidden-input').value;
      const work_details = document.getElementById('work-details').value;
      const pending_details = document.getElementById('pending-details').value;
      const report_date = document.getElementById('report-date-picker').value;

      if (!employee_id) {
        showToast('กรุณาเลือกรายชื่อพนักงานก่อนส่งข้อมูล', 'error');
        return;
      }
      if (!terminal_id) {
        showToast('กรุณาเลือกสถานที่ปฏิบัติงาน (อู่รถ) ก่อนส่งข้อมูล', 'error');
        return;
      }

      btnSubmit.disabled = true;
      submitSpinner.style.display = 'inline-block';
      submitText.textContent = 'กำลังส่งข้อมูล...';

      const isEditing = editingReportId !== null;

      try {
        let res;
        if (isEditing) {
          // --- UPDATE existing report ---
          res = await fetch(\`/api/reports/\${editingReportId}\`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              employee_id,
              terminal_id,
              work_details,
              pending_details,
              report_date
            })
          });
        } else {
          // --- CREATE new report ---
          res = await fetch('/api/reports', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              employee_id,
              terminal_id,
              work_details,
              pending_details,
              report_date
            })
          });
        }

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'การส่งข้อมูลขัดข้อง');

        if (isEditing) {
          showToast('แก้ไขรายงานปฏิบัติงานเรียบร้อยแล้ว ✅', 'success');
          cancelEdit();
        } else {
          showToast('บันทึกรายงานการปฏิบัติงานเรียบร้อยแล้ว', 'success');
          document.getElementById('work-details').value = '';
          document.getElementById('pending-details').value = '';
          employeeDropdownControl.reset();
          terminalDropdownControl.reset();
        }

        await fetchReports();

      } catch (err) {
        showToast('ส่งรายงานไม่สำเร็จ: ' + err.message, 'error');
      } finally {
        btnSubmit.disabled = false;
        submitSpinner.style.display = 'none';
        if (!editingReportId) {
          submitText.textContent = 'ส่งรายงานปฏิบัติงาน';
          btnSubmit.style.background = '';
        }
      }
    });

    // Cancel Edit button
    document.getElementById('btn-cancel-edit').addEventListener('click', () => {
      cancelEdit();
    });

    // Delete Report button
    document.getElementById('btn-delete-report').addEventListener('click', async () => {
      if (!editingReportId) return;
      if (!confirm('คุณต้องการลบข้อมูลรายงานนี้ใช่หรือไม่? (การลบจะไม่สามารถย้อนกลับได้)')) {
        return;
      }
      
      const btnDelete = document.getElementById('btn-delete-report');
      btnDelete.disabled = true;
      btnDelete.textContent = 'กำลังลบข้อมูล...';
      
      try {
        const res = await fetch(\`/api/reports/\${editingReportId}\`, {
          method: 'DELETE'
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'การลบข้อมูลขัดข้อง');
        
        showToast('ลบข้อมูลรายงานเรียบร้อยแล้ว 🗑️', 'success');
        cancelEdit();
        await fetchReports();
        
        // Also fetch summary reports if summary tab is open
        const activeTabBtn = document.querySelector('.tab-btn.active');
        if (activeTabBtn && activeTabBtn.dataset.tab === 'summary') {
          await fetchSummaryReports();
        }
      } catch (err) {
        showToast('ลบข้อมูลไม่สำเร็จ: ' + err.message, 'error');
      } finally {
        btnDelete.disabled = false;
        btnDelete.textContent = '🗑️ ลบข้อมูล';
      }
    });

    // Date Picker event (Kanban)
    datePicker.addEventListener('change', () => {
      fetchReports();
    });

    document.getElementById('btn-reset-today').addEventListener('click', () => {
      if (datePicker.value !== bangkokToday) {
        datePicker.value = bangkokToday;
        fetchReports();
      }
    });

    // Summary Search Button click
    document.getElementById('btn-search-summary').addEventListener('click', () => {
      // Clear preset button active states
      document.querySelectorAll('.btn-preset').forEach(btn => btn.classList.remove('active'));
      fetchSummaryReports();
    });

    document.getElementById('summary-employee-filter').addEventListener('change', () => {
      document.querySelectorAll('.btn-preset').forEach(btn => btn.classList.remove('active'));
      fetchSummaryReports();
    });

    document.getElementById('summary-status-filter').addEventListener('change', () => {
      document.querySelectorAll('.btn-preset').forEach(btn => btn.classList.remove('active'));
      fetchSummaryReports();
    });


    // Excel Export implementation
    document.getElementById('btn-export-excel').addEventListener('click', () => {
      if (typeof XLSX === 'undefined') {
        showToast('กำลังโหลดโมดูล Export Excel...', 'success');
        const script = document.createElement('script');
        script.src = "https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js";
        script.onload = () => {
          doExport();
        };
        script.onerror = () => {
          showToast('ไม่สามารถโหลดโมดูลสำหรับ Export Excel ได้', 'error');
        };
        document.head.appendChild(script);
      } else {
        doExport();
      }
    });

    function doExport() {
      if (summaryReports.length === 0) {
        showToast('ไม่มีข้อมูลที่จะส่งออกในช่วงเวลาที่กำหนด', 'error');
        return;
      }

      // Map raw data array
      const data = summaryReports.map(r => {
        let displayDateTime = r.created_at || '';
        if (r.created_at) {
          const parts = r.created_at.split(' ');
          const datePart = parts[0];
          const timePart = parts.length > 1 ? parts[1].substring(0, 5) + ' น.' : '';
          const dateParts = datePart.split('-');
          if (dateParts.length === 3) {
            const displayDate = \`\${dateParts[2]}-\${dateParts[1]}-\${dateParts[0]}\`;
            displayDateTime = displayDate + (timePart ? \` \${timePart}\` : '');
          }
        }
        return [
          displayDateTime,
          r.employee_name,
          r.employee_nickname || '',
          r.terminal_name,
          r.work_details,
          r.pending_details || '',
          r.status
        ];
      });

      // Unshift headers
      data.unshift([
        'วันที่รายงาน',
        'ชื่อพนักงาน',
        'ชื่อเล่น',
        'สถานที่ปฏิบัติงาน (อู่รถ)',
        'รายละเอียดการทำงาน (ทำงานอะไรบ้าง)',
        'งานที่ค้างคา (มีอะไรที่ยังค้างอยู่)',
        'สถานะ'
      ]);

      const ws = XLSX.utils.aoa_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Daily Reports");

      const start = summaryStartDateInput.value;
      const end = summaryEndDateInput.value;
      
      XLSX.writeFile(wb, \`Daily_Reports_\${start}_to_\${end}.xlsx\`);
      showToast('ดาวน์โหลดไฟล์ Excel สำเร็จ', 'success');
    }

    // Tabs logic
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        // Deactivate all tabs
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

        // Activate clicked tab
        btn.classList.add('active');
        const targetTab = btn.dataset.tab;
        document.getElementById(\`tab-content-\${targetTab}\`).classList.add('active');

        // Fetch reports if switching to summary
        if (targetTab === 'summary') {
          // Default: fetch range if first load
          fetchSummaryReports();
        } else if (targetTab === 'kanban') {
          fetchReports();
        }
      });
    });

    // Start App
    loadInitialData();
  </script>
</body>
</html>
  `;
  return c.html(htmlContent);
});

export default app;
