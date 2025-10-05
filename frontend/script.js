const API_BASE = "http://localhost:3000";

let state = {
  tickets: [],
  agents: [],
  activity: [],
  kb: [],
  settings: { theme: "dark" },
  loggedInUser: null,
  filters: { agent: "all", status: "all", priority: "all", search: "" },
  sort: { key: "created", order: "desc" }
};

function persist() {
  localStorage.setItem("helpdesk_state", JSON.stringify(state));
}

function loadLocal() {
  const s = localStorage.getItem("helpdesk_state");
  if (s) state = JSON.parse(s);
}

function clearOldState() {
  localStorage.removeItem("skillvision_state");
}

function genId(){ return Date.now() + Math.floor(Math.random()*1000); }
function fmtDate(d){ return new Date(d).toLocaleString(); }

function notify(msg){
  const n = document.createElement("div");
  n.className = "toast";
  n.textContent = msg;
  document.body.appendChild(n);
  setTimeout(()=> n.remove(), 3000);
}

function addActivity(msg){
  state.activity.unshift({id:genId(),msg,time:Date.now()});
  persist();
}

function escapeHtml(unsafe){
  return String(unsafe||"").replace(/[&<>"'`=\/]/g, s=>{
    return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;","/":"&#x2F;","`":"&#x60;","=":"&#x3D;"})[s];
  });
}

async function login() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value.trim();

  if (!email || !password) { 
    alert("All fields are required"); 
    return; 
  }

  try {
    const res = await fetch(`${API_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();

    if (res.ok) {
      state.loggedInUser = data.user;
      persist();

      document.getElementById('auth-section').style.display = 'none';
      document.getElementById('app').style.display = 'flex';

      document.getElementById('profileName').textContent = data.user.name;
      document.getElementById('profileAvatar').textContent = data.user.name[0].toUpperCase();

      await loadTickets();
      await loadUsers();
      renderAll();
    } else {
      alert(data.message);
    }
  } catch(err) {
    console.error("Login error:", err);
    alert("Login failed. Check server console.");
  }
}

async function signup() {
  const name = document.getElementById('signupName').value.trim();
  const email = document.getElementById('signupEmail').value.trim();
  const password = document.getElementById('signupPassword').value.trim();

  if (!name || !email || !password) { 
    alert("All fields are required"); 
    return; 
  }

  try {
    const res = await fetch(`${API_BASE}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password, role: "user" })
    });
    const data = await res.json();

    alert(data.message);
    if (res.ok) toggleAuth('login');
  } catch(err) {
    console.error("Signup error:", err);
    alert("Signup failed. Check server console.");
  }
}

function toggleAuth(view){
  document.getElementById("loginForm").style.display = view==='login'?'block':'none';
  document.getElementById("signupForm").style.display = view==='signup'?'block':'none';
}

async function loadTickets(){
  try {
    const params = new URLSearchParams();
    if(state.filters.agent!=="all") params.append("agent", state.filters.agent);
    if(state.filters.status!=="all") params.append("status", state.filters.status);

    const res = await fetch(`${API_BASE}/tickets?${params.toString()}`);
    const tickets = await res.json();
    state.tickets = tickets.map(t => ({
      ...t,
      created: t.created_at ? new Date(t.created_at).getTime() : Date.now()
    }));
  } catch(err) {
    console.error("Failed to load tickets:", err);
    state.tickets = [];
  }
}

async function loadUsers() {
  try {
    const res = await fetch(`${API_BASE}/users`);
    const users = await res.json();
    state.agents = users.map(u => ({ id: u.id, name: u.name, email: u.email }));
  } catch(err) {
    console.error("Failed to load users:", err);
    state.agents = [];
  }
}

async function loadReports() {
  await loadTickets(); // reports are based on tickets
}

function renderReports(){
  const tableWrap = document.getElementById("reportsTable");
  if(!tableWrap) return;

  const rows = state.tickets.map(t => `
    <tr>
      <td>${t.id}</td>
      <td>${escapeHtml(t.title)}</td>
      <td>${escapeHtml(t.status)}</td>
      <td>${escapeHtml(t.priority)}</td>
      <td>${escapeHtml(t.agent||"")}</td>
      <td>${fmtDate(t.created)}</td>
    </tr>
  `).join("");

  tableWrap.innerHTML = `<table>
    <thead>
      <tr><th>ID</th><th>Title</th><th>Status</th><th>Priority</th><th>Agent</th><th>Created</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

async function getAIResponse(prompt){
  try {
    const res = await fetch(`${API_BASE}/api/ai-response`, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ prompt })
    });
    const data = await res.json();
    if(res.ok) return data.response;
    notify("AI request failed");
  } catch(err){
    console.error("AI Error:", err);
    notify("AI request failed");
  }
}

async function handleAIChat(){
  const prompt = document.getElementById("aiPrompt").value.trim();
  if(!prompt) return;
  const response = await getAIResponse(prompt);
  if(response){
    const chatBox = document.getElementById("aiResponse");
    chatBox.textContent = response;
    addActivity(`AI responded to prompt: "${prompt}"`);
  }
}

async function createTicket(data){
  try {
    const res = await fetch(`${API_BASE}/tickets`, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({
        ...data,
        status: data.status||"Open",
        created_at: new Date().toISOString()
      })
    });
    const ticket = await res.json();
    state.tickets.unshift(ticket);
    addActivity(`Created ticket "${ticket.title}"`);
    persist();
    renderAll();
    notify(`New ticket: ${ticket.title}`);
  } catch(err){
    console.error("Ticket creation failed:", err);
    notify("Failed to create ticket");
  }
}

async function updateTicket(id,data){
  const t = state.tickets.find(t=>t.id==id);
  if(!t) return;
  try {
    const res = await fetch(`${API_BASE}/tickets/${id}`, {
      method: "PUT",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify(data)
    });
    if(res.ok){
      Object.assign(t,data);
      addActivity(`Updated ticket "${t.title}"`);
      persist();
      renderAll();
    } else {
      notify("Failed to update ticket");
    }
  } catch(err){
    console.error("Update failed:", err);
    notify("Failed to update ticket");
  }
}

async function deleteTicket(id){
  try {
    const res = await fetch(`${API_BASE}/tickets/${id}`, { method: "DELETE" });
    if(res.ok){
      state.tickets = state.tickets.filter(t=>t.id!=id);
      addActivity(`Deleted ticket ${id}`);
      persist();
      renderAll();
    } else {
      notify("Failed to delete ticket");
    }
  } catch(err){
    console.error("Delete failed:", err);
    notify("Failed to delete ticket");
  }
}

function filterAndSortTickets(){
  let tickets = [...state.tickets];

  if(state.filters.agent !== "all") tickets = tickets.filter(t=>t.agent===state.filters.agent);
  if(state.filters.status !== "all") tickets = tickets.filter(t=>t.status===state.filters.status);
  if(state.filters.priority !== "all") tickets = tickets.filter(t=>t.priority===state.filters.priority);
  if(state.filters.search) tickets = tickets.filter(t=>t.title.toLowerCase().includes(state.filters.search.toLowerCase()) || (t.description||"").toLowerCase().includes(state.filters.search.toLowerCase()));

  tickets.sort((a,b)=>{
    let valA = a[state.sort.key];
    let valB = b[state.sort.key];
    if(state.sort.key === "created") return state.sort.order==="asc"?valA-valB:valB-valA;
    return state.sort.order==="asc"?valA.localeCompare(valB):valB.localeCompare(valA);
  });

  return tickets;
}

function populateAgentSelects(){
  const tAgent = document.getElementById("tAgent");
  if(tAgent){
    tAgent.innerHTML = `<option value="">Unassigned</option>` +
      state.agents.map(a=>`<option value="${a.name}">${a.name}</option>`).join("");
  }
  const filterAgent = document.getElementById("filterAgent");
  if(filterAgent){
    filterAgent.innerHTML = `<option value="all">All Agents</option>` +
      state.agents.map(a=>`<option value="${a.name}">${a.name}</option>`).join("");
    filterAgent.addEventListener("change", e=>{
      state.filters.agent = e.target.value;
      renderTickets();
    });
  }

  const filterStatus = document.getElementById("filterStatus");
  if(filterStatus){
    filterStatus.addEventListener("change", e=>{
      state.filters.status = e.target.value;
      renderTickets();
    });
  }

  const filterPriority = document.getElementById("filterPriority");
  if(filterPriority){
    filterPriority.addEventListener("change", e=>{
      state.filters.priority = e.target.value;
      renderTickets();
    });
  }

  const searchInput = document.getElementById("searchTickets");
  if(searchInput){
    searchInput.addEventListener("input", e=>{
      state.filters.search = e.target.value;
      renderTickets();
    });
  }
}

function renderDashboard(){
  const tickets = filterAndSortTickets();
  const open = tickets.filter(t=>t.status=="Open").length;
  const prog = tickets.filter(t=>t.status=="In Progress").length;
  const closed = tickets.filter(t=>t.status=="Closed").length;

  document.getElementById("statTotal").textContent = tickets.length;
  document.getElementById("statOpen").textContent = open;
  document.getElementById("statProgress").textContent = prog;
  document.getElementById("statClosed").textContent = closed;

  const canvas = document.getElementById("statusChart");
  if(canvas){
    const ctx = canvas.getContext("2d");
    if(window.statusChart) window.statusChart.destroy();
    window.statusChart = new Chart(ctx,{
      type:"doughnut",
      data:{labels:["Open","In Progress","Closed"],datasets:[{data:[open,prog,closed],backgroundColor:["#e74c3c","#f39c12","#2ecc71"]}]},
      options:{responsive:true,maintainAspectRatio:false}
    });
  }
}

function renderTickets(){
  const filteredTickets = filterAndSortTickets();
  const tableWrap = document.getElementById("ticketsTable");
  if(tableWrap){
    const rows = filteredTickets.map(t=>`
      <tr data-id="${t.id}">
        <td>${t.id}</td>
        <td>${escapeHtml(t.title)}</td>
        <td>${escapeHtml(t.status)}</td>
        <td>${escapeHtml(t.priority)}</td>
        <td>${escapeHtml(t.agent||"")}</td>
        <td>
          <button class="edit-btn" data-id="${t.id}">Edit</button>
          <button class="delete-btn" data-id="${t.id}">Delete</button>
        </td>
      </tr>`).join("");
    tableWrap.innerHTML = `<table>
      <thead><tr><th>ID</th><th>Title</th><th>Status</th><th>Priority</th><th>Agent</th><th>Actions</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  ["open","in_progress","closed"].forEach(st=>{
    const list = document.querySelector(`[data-list='${st}']`);
    if(!list) return;
    list.innerHTML = "";
    filteredTickets
      .filter(t => (t.status||"").replace(" ","_").toLowerCase()===st)
      .forEach(t=>{
        const div = document.createElement("div");
        div.className="card-item";
        div.innerHTML = `<div class="card-head">
          <div class="left"><div class="card-title">${escapeHtml(t.title)}</div></div>
          <div class="right"><span class="badge">${escapeHtml(t.priority)}</span></div>
        </div>
        <div class="card-desc">${escapeHtml(t.description||"")}</div>`;
        list.appendChild(div);
      });
  });

  document.querySelectorAll(".edit-btn").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const id = btn.dataset.id;
      openEditModal(id);
    });
  });
  document.querySelectorAll(".delete-btn").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const id = btn.dataset.id;
      if(confirm("Are you sure you want to delete this ticket?")){
        deleteTicket(id);
      }
    });
  });

  renderDashboard();
}

function renderUsers(){
  const list = document.getElementById("userList");
  if(!list) return;
  list.innerHTML = "";
  state.agents.forEach(u=>{
    const div=document.createElement("div");
    div.className="user-card";
    div.innerHTML=`<div class="avatar">${escapeHtml((u.name||"")[0]||"U")}</div>
      <div class="info"><div class="name">${escapeHtml(u.name||"")}</div>
      <div class="email">${escapeHtml(u.email||"")}</div></div>`;
    list.appendChild(div);
  });
}

function renderActivity(){
  const feed = document.getElementById("activityFeed");
  if(!feed) return;
  feed.innerHTML = "";
  state.activity.forEach(a=>{
    const li = document.createElement("div");
    li.className="activity-item";
    li.textContent=`${a.msg} (${fmtDate(a.time)})`;
    feed.appendChild(li);
  });
}

function renderAll(){
  populateAgentSelects();
  renderTickets();
  renderUsers();
  renderActivity();
}

const modal = document.getElementById("modal");
const ticketForm = document.getElementById("ticketForm");
const tTitle = document.getElementById("tTitle");
let editingTicketId = null;

function openModal() {
  editingTicketId = null;
  modal.classList.add("show");
  ticketForm.reset();
  setTimeout(() => tTitle.focus(), 50);
}

function openEditModal(id){
  const t = state.tickets.find(t=>t.id==id);
  if(!t) return;
  editingTicketId = id;
  modal.classList.add("show");
  tTitle.value = t.title;
  document.getElementById("tPriority").value = t.priority;
  document.getElementById("tStatus").value = t.status;
  document.getElementById("tAgent").value = t.agent;
  document.getElementById("tDesc").value = t.description;
  setTimeout(() => tTitle.focus(), 50);
}

function closeModal() {
  modal.classList.remove("show");
  ticketForm.reset();
  editingTicketId = null;
}

ticketForm.addEventListener("submit", async (e)=>{
  e.preventDefault();
  const data = {
    title: tTitle.value,
    priority: document.getElementById("tPriority").value,
    status: document.getElementById("tStatus").value,
    agent: document.getElementById("tAgent").value,
    description: document.getElementById("tDesc").value
  };
  if(editingTicketId){
    await updateTicket(editingTicketId,data);
  } else {
    await createTicket(data);
  }
  closeModal();
});

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', async () => {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const section = btn.dataset.section;
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(section).classList.add('active');
    document.getElementById('pageTitle').textContent = section.charAt(0).toUpperCase() + section.slice(1);

    // Dynamic render per section
    if(section === 'users') renderUsers();
    if(section === 'reports') {
      await loadReports();
      renderReports();
    }
  });
});

(async function init(){
  clearOldState();
  loadLocal();

  document.getElementById("loginBtn").addEventListener("click", login);
  document.getElementById("signupBtn").addEventListener("click", signup);
  document.getElementById("showLogin").addEventListener("click", ()=>toggleAuth('login'));
  document.getElementById("showSignup").addEventListener("click", ()=>toggleAuth('signup'));

  document.getElementById("openModalBtn")?.addEventListener("click", openModal);
  document.getElementById("closeModalBtn")?.addEventListener("click", closeModal);

  document.getElementById("aiSend")?.addEventListener("click", handleAIChat);

  if(state.loggedInUser){
    document.getElementById('auth-section').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    document.getElementById('profileName').textContent = state.loggedInUser.name;
    document.getElementById('profileAvatar').textContent = state.loggedInUser.name[0].toUpperCase();
    await loadTickets();
    await loadUsers();
    renderAll();
  }
})();