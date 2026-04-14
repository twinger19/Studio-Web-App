/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  auth, db, googleProvider, signInWithPopup, signOut, onAuthStateChanged, 
  collection, onSnapshot, query, where, orderBy, setDoc, updateDoc, deleteDoc, 
  doc, addDoc, serverTimestamp, Timestamp, User, handleFirestoreError, OperationType 
} from './lib/firebase';
import { 
  UserProfile, Member, Brand, Project, Task, Note, Meeting, Travel, Link 
} from './types';
import { 
  Search, Calendar, CheckSquare, Package, Cloud, Plus, MoreVertical, 
  ChevronRight, ChevronDown, LogOut, LayoutDashboard, ExternalLink, 
  Trash2, Edit2, Briefcase, User as UserIcon, MapPin, Link as LinkIcon,
  Clock, AlertCircle, CheckCircle2, Circle, GripVertical, Menu, X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format, addDays, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isToday, parseISO, addMonths, subMonths, isWithinInterval } from 'date-fns';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Constants ---
const COLORS = ['#6376DA', '#E88B6D', '#6DB8E8', '#9B6DE8', '#50C08A', '#E8CC5A', '#E86D8B', '#5AC8E8'];
const PRODUCT_DEVELOPMENT_TEMPLATE = [
  'Line Plan Due', 'Design/CAD Phase', 'Internal CAD Review', 'External CAD Review',
  'Tech Pack Phase', 'Sampling Time Phase', 'First Samples Due', 'Midpoint Prep Phase',
  'Internal Midpoint', 'External Midpoint', 'Tech Packs Updates', 'Second Round Sample Phase',
  'Second Round Samples Due', 'Line Final Prep', 'Internal Line Final', 'External Line Final',
  'Final Tech Pack Updates'
];

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authReady, setAuthReady] = useState(false);

  // --- Real-time Data State ---
  const [members, setMembers] = useState<Member[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [travel, setTravel] = useState<Travel[]>([]);
  const [links, setLinks] = useState<Link[]>([]);

  // --- UI State ---
  const [selId, setSelId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'home' | 'detail' | 'calendar' | 'sync' | 'allcal' | 'globaltasks'>('home');
  const [calMode, setCalMode] = useState<'month' | '6month'>('month');
  const [calDate, setCalDate] = useState(new Date());
  const [calFilter, setCalFilter] = useState<'all' | 'tasks' | 'meetings'>('all');
  const [calOwnerFilter, setCalOwnerFilter] = useState('all');
  const [showArchived, setShowArchived] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [openMembers, setOpenMembers] = useState<Set<string>>(new Set());
  const [openBrands, setOpenBrands] = useState<Set<string>>(new Set());

  // --- Auth Effect ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setAuthReady(true);
      setLoading(false);
      if (u) {
        // Initialize user profile in Firestore
        const userRef = doc(db, 'users', u.uid);
        await setDoc(userRef, {
          uid: u.uid,
          displayName: u.displayName,
          email: u.email,
          photoURL: u.photoURL,
          createdAt: serverTimestamp()
        }, { merge: true }).catch(err => handleFirestoreError(err, OperationType.WRITE, `users/${u.uid}`));

        // Check if user has any members, if not, create default "Me" member
        // This is handled in the data sync effect for simplicity
      }
    });
    return unsubscribe;
  }, []);

  // --- Data Sync Effects ---
  useEffect(() => {
    if (!user) return;

    const q = (path: string) => query(collection(db, path), where('ownerId', '==', user.uid));

    const unsubMembers = onSnapshot(q('members'), async (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as Member));
      
      if (data.length === 0 && authReady) {
        // Create default "Me" member and "My Projects" brand
        try {
          const memberRef = await addDoc(collection(db, 'members'), {
            name: 'Me',
            color: COLORS[0],
            isMe: true,
            ownerId: user.uid,
            order: 0
          });
          await addDoc(collection(db, 'brands'), {
            name: 'My Projects',
            memberId: memberRef.id,
            ownerId: user.uid,
            order: 0
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, 'members/brands');
        }
      }

      setMembers(data.sort((a, b) => (a.order || 0) - (b.order || 0)));
      // Auto-open "Me" member on first load
      if (openMembers.size === 0) {
        const me = data.find(m => m.isMe);
        if (me) setOpenMembers(new Set([me.id]));
      }
    }, err => handleFirestoreError(err, OperationType.LIST, 'members'));

    const unsubBrands = onSnapshot(q('brands'), (snap) => {
      setBrands(snap.docs.map(d => ({ id: d.id, ...d.data() } as Brand)).sort((a, b) => (a.order || 0) - (b.order || 0)));
    }, err => handleFirestoreError(err, OperationType.LIST, 'brands'));

    const unsubProjects = onSnapshot(q('projects'), (snap) => {
      setProjects(snap.docs.map(d => ({ id: d.id, ...d.data() } as Project)).sort((a, b) => (a.name || '').localeCompare(b.name || '')));
    }, err => handleFirestoreError(err, OperationType.LIST, 'projects'));

    const unsubTasks = onSnapshot(q('tasks'), (snap) => {
      setTasks(snap.docs.map(d => ({ id: d.id, ...d.data() } as Task)).sort((a, b) => (a.order || 0) - (b.order || 0)));
    }, err => handleFirestoreError(err, OperationType.LIST, 'tasks'));

    const unsubNotes = onSnapshot(q('notes'), (snap) => {
      setNotes(snap.docs.map(d => ({ id: d.id, ...d.data() } as Note)).sort((a, b) => (a.order || 0) - (b.order || 0)));
    }, err => handleFirestoreError(err, OperationType.LIST, 'notes'));

    const unsubMeetings = onSnapshot(q('meetings'), (snap) => {
      setMeetings(snap.docs.map(d => ({ id: d.id, ...d.data() } as Meeting)).sort((a, b) => (a.date || '').localeCompare(b.date || '')));
    }, err => handleFirestoreError(err, OperationType.LIST, 'meetings'));

    const unsubTravel = onSnapshot(q('travel'), (snap) => {
      setTravel(snap.docs.map(d => ({ id: d.id, ...d.data() } as Travel)).sort((a, b) => (a.startDate || '').localeCompare(b.startDate || '')));
    }, err => handleFirestoreError(err, OperationType.LIST, 'travel'));

    const unsubLinks = onSnapshot(q('links'), (snap) => {
      setLinks(snap.docs.map(d => ({ id: d.id, ...d.data() } as Link)).sort((a, b) => (a.label || '').localeCompare(b.label || '')));
    }, err => handleFirestoreError(err, OperationType.LIST, 'links'));

    return () => {
      unsubMembers(); unsubBrands(); unsubProjects(); unsubTasks();
      unsubNotes(); unsubMeetings(); unsubTravel(); unsubLinks();
    };
  }, [user]);

  // --- Derived State ---
  const selectedProject = useMemo(() => projects.find(p => p.id === selId), [projects, selId]);
  const projectTasks = useMemo(() => tasks.filter(t => t.projectId === selId), [tasks, selId]);
  const projectNotes = useMemo(() => notes.filter(n => n.projectId === selId), [notes, selId]);
  const projectMeetings = useMemo(() => meetings.filter(m => m.projectId === selId), [meetings, selId]);
  const projectTravel = useMemo(() => travel.filter(t => t.projectId === selId), [travel, selId]);
  const projectLinks = useMemo(() => links.filter(l => l.projectId === selId), [links, selId]);

  const alerts = useMemo(() => {
    const today = format(new Date(), 'yyyy-MM-dd');
    const soon = format(addDays(new Date(), 7), 'yyyy-MM-dd');
    const overdue: { t: Task, p: Project }[] = [];
    const upcoming: { t: Task, p: Project }[] = [];

    tasks.forEach(t => {
      const p = projects.find(proj => proj.id === t.projectId);
      if (!p || p.status === 'archived' || t.progress === 'completed' || !t.dueDate) return;
      if (t.dueDate < today) overdue.push({ t, p });
      else if (t.dueDate <= soon) upcoming.push({ t, p });
    });

    return { overdue, upcoming };
  }, [tasks, projects]);

  // --- Handlers ---
  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error('Login failed', err);
    }
  };

  const handleLogout = () => signOut(auth);

  const toggleMember = (id: string) => {
    const next = new Set(openMembers);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOpenMembers(next);
  };

  const toggleBrand = (id: string) => {
    const next = new Set(openBrands);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOpenBrands(next);
  };

  const goProject = (id: string) => {
    setSelId(id);
    setViewMode('detail');
    setIsMobileSidebarOpen(false);
    const p = projects.find(proj => proj.id === id);
    if (p) {
      setOpenMembers(prev => new Set([...prev, p.memberId]));
      setOpenBrands(prev => new Set([...prev, p.brandId]));
    }
  };

  const createProject = async (brandId: string, memberId: string) => {
    if (!user) return;
    const name = prompt('Project Name:');
    if (!name) return;
    try {
      const docRef = await addDoc(collection(db, 'projects'), {
        name,
        brandId,
        memberId,
        ownerId: user.uid,
        status: 'active',
        summary: '',
        startDate: '',
        endDate: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      goProject(docRef.id);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'projects');
    }
  };

  const addTask = async (projectId: string) => {
    if (!user) return;
    const text = prompt('Task:');
    if (!text) return;
    try {
      await addDoc(collection(db, 'tasks'), {
        text,
        projectId,
        ownerId: user.uid,
        progress: 'not-started',
        startDate: '',
        dueDate: '',
        order: tasks.length,
        createdAt: serverTimestamp()
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'tasks');
    }
  };

  const updateTaskProgress = async (taskId: string, progress: Task['progress']) => {
    try {
      await updateDoc(doc(db, 'tasks', taskId), { progress });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `tasks/${taskId}`);
    }
  };

  const addNote = async (projectId: string) => {
    if (!user) return;
    try {
      await addDoc(collection(db, 'notes'), {
        title: 'New Note',
        body: '',
        projectId,
        ownerId: user.uid,
        date: format(new Date(), 'MMM d, yyyy'),
        order: notes.length,
        createdAt: serverTimestamp()
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'notes');
    }
  };

  // --- Render Helpers ---
  if (loading) return <div className="flex items-center justify-center h-screen bg-slate-50">Loading Studio W...</div>;

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-[#1C1F2E] text-white p-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white/5 border border-white/10 p-10 rounded-3xl shadow-2xl max-w-md w-full text-center"
        >
          <h1 className="text-3xl font-bold mb-2">Studio <em className="text-[#6376DA] not-italic">W</em></h1>
          <p className="text-slate-400 mb-8">Professional task management and note-taking for product development teams.</p>
          <button 
            onClick={handleLogin}
            className="w-full bg-[#6376DA] hover:bg-[#4F63C9] text-white font-semibold py-4 rounded-xl transition-all flex items-center justify-center gap-3"
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-6 h-6 bg-white rounded-full p-1" alt="Google" />
            Sign in with Google
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#F4F5F8]">
      {/* Sidebar Overlay */}
      <AnimatePresence>
        {isMobileSidebarOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsMobileSidebarOpen(false)}
            className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 w-64 bg-[#1C1F2E] z-50 transform transition-transform duration-300 lg:relative lg:translate-x-0",
        isMobileSidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="flex flex-col h-full">
          <div className="p-6 border-b border-white/5">
            <button onClick={() => setViewMode('home')} className="text-xl font-bold text-white tracking-tight">
              Studio <em className="text-[#6376DA] not-italic">W</em>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto py-4 sb-scroll">
            {/* Alerts Summary */}
            {(alerts.overdue.length > 0 || alerts.upcoming.length > 0) && (
              <div className="px-4 mb-6">
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3 px-2">Alerts</div>
                <div className="space-y-1">
                  {alerts.overdue.slice(0, 3).map(({ t, p }) => (
                    <button 
                      key={t.id} 
                      onClick={() => goProject(p.id)}
                      className="w-full text-left p-2 rounded-lg hover:bg-white/5 flex items-center gap-3 group transition-colors"
                    >
                      <div className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                      <div className="min-width-0">
                        <div className="text-xs font-medium text-slate-200 truncate">{p.name}</div>
                        <div className="text-[10px] text-slate-500 truncate">Overdue: {t.text}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Members Tree */}
            <div className="space-y-1">
              {members.map(m => (
                <div key={m.id}>
                  <div className="flex items-center px-4 py-2 group cursor-pointer hover:bg-white/5" onClick={() => toggleMember(m.id)}>
                    <div className="w-2 h-2 rounded-full mr-3 shrink-0" style={{ backgroundColor: m.color }} />
                    <span className="flex-1 text-sm font-medium text-slate-200">{m.name}</span>
                    <ChevronRight className={cn("w-3 h-3 text-slate-500 transition-transform", openMembers.has(m.id) && "rotate-90")} />
                  </div>
                  
                  {openMembers.has(m.id) && (
                    <div className="ml-4 border-l border-white/5">
                      {brands.filter(b => b.memberId === m.id).map(b => (
                        <div key={b.id}>
                          <div className="flex items-center px-4 py-1.5 group cursor-pointer hover:bg-white/5" onClick={() => toggleBrand(b.id)}>
                            <ChevronRight className={cn("w-3 h-3 text-slate-500 mr-2 transition-transform", openBrands.has(b.id) && "rotate-90")} />
                            <span className="flex-1 text-xs text-slate-400 group-hover:text-slate-200">{b.name}</span>
                          </div>
                          
                          {openBrands.has(b.id) && (
                            <div className="ml-4">
                              {projects.filter(p => p.brandId === b.id && (showArchived || p.status !== 'archived')).map(p => (
                                <button 
                                  key={p.id}
                                  onClick={() => goProject(p.id)}
                                  className={cn(
                                    "w-full text-left px-4 py-1.5 text-xs transition-colors relative",
                                    selId === p.id ? "text-white bg-[#6376DA]/20 font-medium" : "text-slate-500 hover:text-slate-300"
                                  )}
                                >
                                  {selId === p.id && <div className="absolute left-0 inset-y-0 w-0.5 bg-[#6376DA]" />}
                                  <span className={cn(p.status === 'archived' && "opacity-40 line-through")}>{p.name}</span>
                                </button>
                              ))}
                              <button 
                                onClick={() => createProject(b.id, m.id)}
                                className="w-full text-left px-4 py-1.5 text-[10px] text-slate-600 hover:text-slate-400 flex items-center gap-1.5"
                              >
                                <Plus className="w-2.5 h-2.5" /> Add Project
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="p-4 border-t border-white/5 space-y-2">
            <button onClick={() => setViewMode('allcal')} className="w-full flex items-center gap-3 px-3 py-2 text-xs text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition-all">
              <Calendar className="w-4 h-4" /> All Teams Calendar
            </button>
            <button onClick={() => setViewMode('globaltasks')} className="w-full flex items-center gap-3 px-3 py-2 text-xs text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition-all">
              <CheckSquare className="w-4 h-4" /> My Global Tasks
            </button>
            <button onClick={() => setShowArchived(!showArchived)} className="w-full flex items-center gap-3 px-3 py-2 text-xs text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition-all">
              <Package className="w-4 h-4" /> {showArchived ? 'Hide Archived' : 'Show Archived'}
            </button>
            <div className="pt-2">
              <button onClick={handleLogout} className="w-full flex items-center gap-3 px-3 py-2 text-xs text-slate-500 hover:text-red-400 hover:bg-red-400/5 rounded-lg transition-all">
                <LogOut className="w-4 h-4" /> Sign Out
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Topbar */}
        <header className="h-14 bg-white border-b border-slate-200 px-4 lg:px-8 flex items-center justify-between shrink-0 shadow-sm z-30">
          <div className="flex items-center gap-4 min-w-0">
            <button onClick={() => setIsMobileSidebarOpen(true)} className="lg:hidden p-2 hover:bg-slate-100 rounded-lg">
              <Menu className="w-5 h-5 text-slate-600" />
            </button>
            <div className="flex items-center gap-2 text-sm text-slate-500 truncate">
              <span className="hover:text-slate-800 cursor-pointer" onClick={() => setViewMode('home')}>Studio W</span>
              {selectedProject && (
                <>
                  <ChevronRight className="w-3 h-3 opacity-30" />
                  <span className="font-semibold text-slate-900 truncate">{selectedProject.name}</span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="relative hidden md:block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input 
                type="text" 
                placeholder="Search..." 
                className="pl-10 pr-4 py-1.5 bg-slate-100 border-none rounded-full text-sm w-48 focus:w-64 focus:bg-white focus:ring-2 focus:ring-[#6376DA]/20 transition-all outline-none"
                onFocus={() => setIsSearchOpen(true)}
              />
            </div>
            
            {selectedProject && (
              <div className="flex bg-slate-100 p-1 rounded-lg">
                <button 
                  onClick={() => setViewMode('detail')}
                  className={cn("px-3 py-1 text-xs font-medium rounded-md transition-all", viewMode === 'detail' ? "bg-white text-[#6376DA] shadow-sm" : "text-slate-500 hover:text-slate-800")}
                >
                  Detail
                </button>
                <button 
                  onClick={() => setViewMode('calendar')}
                  className={cn("px-3 py-1 text-xs font-medium rounded-md transition-all", viewMode === 'calendar' ? "bg-white text-[#6376DA] shadow-sm" : "text-slate-500 hover:text-slate-800")}
                >
                  Calendar
                </button>
              </div>
            )}
            
            <div className="w-8 h-8 rounded-full bg-[#6376DA] text-white flex items-center justify-center text-xs font-bold shadow-inner">
              {user.displayName?.[0] || 'U'}
            </div>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-4 lg:p-8">
          {viewMode === 'home' && <Dashboard projects={projects} tasks={tasks} alerts={alerts} goProject={goProject} />}
          {viewMode === 'detail' && selectedProject && (
            <div className="max-w-5xl mx-auto space-y-8">
              <div className="flex items-start justify-between">
                <div>
                  <input 
                    className="text-3xl font-bold text-slate-900 bg-transparent border-none outline-none focus:ring-b-2 focus:ring-[#6376DA] w-full"
                    defaultValue={selectedProject.name}
                    onBlur={(e) => {
                      if (e.target.value && e.target.value !== selectedProject.name) {
                        updateDoc(doc(db, 'projects', selectedProject.id), { name: e.target.value });
                      }
                    }}
                  />
                  <div className="flex items-center gap-3 mt-2">
                    <span className={cn(
                      "text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full",
                      selectedProject.status === 'active' ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"
                    )}>
                      {selectedProject.status}
                    </span>
                    <span className="text-xs text-slate-400 flex items-center gap-1">
                      <Briefcase className="w-3 h-3" /> {brands.find(b => b.id === selectedProject.brandId)?.name}
                    </span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className="p-2 hover:bg-slate-200 rounded-lg text-slate-400 hover:text-slate-600 transition-colors">
                    <MoreVertical className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Summary Card */}
              <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-6">
                  <h3 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2">
                    <LayoutDashboard className="w-4 h-4 text-[#6376DA]" /> Project Summary
                  </h3>
                  <textarea 
                    className="w-full min-h-[100px] p-4 bg-slate-50 rounded-xl border border-slate-100 text-sm leading-relaxed focus:bg-white focus:ring-2 focus:ring-[#6376DA]/10 outline-none transition-all"
                    placeholder="Project overview, goals, key contacts..."
                    defaultValue={selectedProject.summary}
                    onBlur={(e) => updateDoc(doc(db, 'projects', selectedProject.id), { summary: e.target.value })}
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Start Date</label>
                      <input 
                        type="date" 
                        className="w-full p-2 bg-white border border-slate-200 rounded-lg text-sm"
                        defaultValue={selectedProject.startDate}
                        onChange={(e) => updateDoc(doc(db, 'projects', selectedProject.id), { startDate: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">End Date</label>
                      <input 
                        type="date" 
                        className="w-full p-2 bg-white border border-slate-200 rounded-lg text-sm"
                        defaultValue={selectedProject.endDate}
                        onChange={(e) => updateDoc(doc(db, 'projects', selectedProject.id), { endDate: e.target.value })}
                      />
                    </div>
                  </div>
                </div>
              </section>

              {/* Tasks Section */}
              <section className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <CheckSquare className="w-4 h-4 text-[#6376DA]" /> Tasks
                    <span className="bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full text-[10px] ml-2">
                      {projectTasks.filter(t => t.progress === 'completed').length}/{projectTasks.length}
                    </span>
                  </h3>
                  <button 
                    onClick={() => addTask(selectedProject.id)}
                    className="text-xs font-semibold text-[#6376DA] hover:text-[#4F63C9] flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" /> Add Task
                  </button>
                </div>
                
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm divide-y divide-slate-100">
                  {projectTasks.length === 0 ? (
                    <div className="p-12 text-center">
                      <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-3">
                        <CheckSquare className="w-6 h-6 text-slate-300" />
                      </div>
                      <p className="text-sm text-slate-400">No tasks yet. Start by adding one above.</p>
                    </div>
                  ) : (
                    projectTasks.map(task => (
                      <div key={task.id} className="p-4 flex items-start gap-4 group hover:bg-slate-50 transition-colors">
                        <button 
                          onClick={() => updateTaskProgress(task.id, task.progress === 'completed' ? 'not-started' : 'completed')}
                          className={cn(
                            "mt-1 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all",
                            task.progress === 'completed' ? "bg-emerald-500 border-emerald-500 text-white" : "border-slate-200 bg-white"
                          )}
                        >
                          {task.progress === 'completed' && <CheckCircle2 className="w-4 h-4" />}
                        </button>
                        <div className="flex-1 min-w-0">
                          <input 
                            className={cn(
                              "w-full bg-transparent border-none outline-none text-sm font-medium",
                              task.progress === 'completed' ? "text-slate-400 line-through" : "text-slate-700"
                            )}
                            defaultValue={task.text}
                            onBlur={(e) => {
                              if (e.target.value && e.target.value !== task.text) {
                                updateDoc(doc(db, 'tasks', task.id), { text: e.target.value });
                              }
                            }}
                          />
                          <div className="flex items-center gap-4 mt-1">
                            <div className="flex items-center gap-1 text-[10px] text-slate-400">
                              <Clock className="w-3 h-3" />
                              <span>Due: {task.dueDate ? friendly(task.dueDate) : 'No date'}</span>
                            </div>
                            <select 
                              className={cn(
                                "text-[10px] font-bold uppercase tracking-wider bg-transparent border-none outline-none",
                                task.progress === 'completed' ? "text-emerald-500" : task.progress === 'in-progress' ? "text-amber-500" : "text-slate-400"
                              )}
                              value={task.progress}
                              onChange={(e) => updateTaskProgress(task.id, e.target.value as Task['progress'])}
                            >
                              <option value="not-started">Not Started</option>
                              <option value="in-progress">In Progress</option>
                              <option value="completed">Completed</option>
                            </select>
                          </div>
                        </div>
                        <button 
                          onClick={() => deleteDoc(doc(db, 'tasks', task.id))}
                          className="opacity-0 group-hover:opacity-100 p-1 text-slate-300 hover:text-red-500 transition-all"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </section>

              {/* Notes Section */}
              <section className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <LayoutDashboard className="w-4 h-4 text-[#6376DA]" /> Notes
                  </h3>
                  <button 
                    onClick={() => addNote(selectedProject.id)}
                    className="text-xs font-semibold text-[#6376DA] hover:text-[#4F63C9] flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" /> Add Note
                  </button>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {projectNotes.map(note => (
                    <div key={note.id} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all group">
                      <div className="flex items-start justify-between mb-2">
                        <input 
                          className="text-base font-bold text-slate-900 bg-transparent border-none outline-none w-full"
                          defaultValue={note.title}
                          onBlur={(e) => updateDoc(doc(db, 'notes', note.id), { title: e.target.value })}
                        />
                        <button 
                          onClick={() => deleteDoc(doc(db, 'notes', note.id))}
                          className="opacity-0 group-hover:opacity-100 p-1 text-slate-300 hover:text-red-500 transition-all"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      <p className="text-xs text-slate-400 mb-4">{note.date}</p>
                      <textarea 
                        className="w-full min-h-[120px] text-sm text-slate-600 bg-slate-50/50 p-3 rounded-xl border-none outline-none focus:bg-white transition-all resize-none"
                        placeholder="Write something..."
                        defaultValue={note.body}
                        onBlur={(e) => updateDoc(doc(db, 'notes', note.id), { body: e.target.value })}
                      />
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}
          {viewMode === 'calendar' && selectedProject && <ProjectCalendar project={selectedProject} tasks={projectTasks} meetings={projectMeetings} />}
          {viewMode === 'allcal' && <AllTeamsCalendar projects={projects} tasks={tasks} members={members} brands={brands} meetings={meetings} />}
          {viewMode === 'globaltasks' && <GlobalTasks tasks={tasks} projects={projects} brands={brands} />}
        </div>
      </main>

      {/* Search Overlay */}
      <AnimatePresence>
        {isSearchOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-start justify-center pt-20 px-4"
            onClick={() => setIsSearchOpen(false)}
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-4 border-b border-slate-100 flex items-center gap-3">
                <Search className="w-5 h-5 text-slate-400" />
                <input 
                  autoFocus
                  type="text" 
                  placeholder="Search projects, tasks, notes..." 
                  className="flex-1 text-lg border-none outline-none"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <button onClick={() => setIsSearchOpen(false)} className="p-2 hover:bg-slate-100 rounded-full">
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>
              <div className="max-h-[60vh] overflow-y-auto p-2">
                {/* Search results logic would go here */}
                <div className="p-8 text-center text-slate-400 text-sm">
                  {searchQuery ? `No results found for "${searchQuery}"` : 'Start typing to search...'}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Sub-components ---

function Dashboard({ projects, tasks, alerts, goProject }: { projects: Project[], tasks: Task[], alerts: any, goProject: (id: string) => void }) {
  const activeProjects = projects.filter(p => p.status === 'active');
  const openTasks = tasks.filter(t => {
    const p = projects.find(proj => proj.id === t.projectId);
    return p && p.status === 'active' && t.progress !== 'completed';
  });

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <header>
        <h2 className="text-3xl font-bold text-slate-900 tracking-tight">Dashboard</h2>
        <p className="text-slate-500 mt-1">Welcome back. Here's what's happening across your projects.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Active Projects</div>
          <div className="text-4xl font-bold text-slate-900">{activeProjects.length}</div>
          <div className="text-xs text-slate-500 mt-2 flex items-center gap-1">
            <Package className="w-3 h-3" /> {projects.length - activeProjects.length} archived
          </div>
        </div>
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Open Tasks</div>
          <div className="text-4xl font-bold text-slate-900">{openTasks.length}</div>
          <div className="text-xs text-slate-500 mt-2 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-emerald-500" /> {tasks.length - openTasks.length} completed
          </div>
        </div>
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Needs Attention</div>
          <div className="text-4xl font-bold text-red-500">{alerts.overdue.length}</div>
          <div className="text-xs text-slate-500 mt-2 flex items-center gap-1">
            <AlertCircle className="w-3 h-3 text-amber-500" /> {alerts.upcoming.length} upcoming this week
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <section className="space-y-4">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <LayoutDashboard className="w-4 h-4 text-[#6376DA]" /> Recent Projects
          </h3>
          <div className="space-y-3">
            {activeProjects.slice(0, 5).map(p => (
              <button 
                key={p.id} 
                onClick={() => goProject(p.id)}
                className="w-full bg-white p-4 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:border-[#6376DA]/30 transition-all text-left flex items-center justify-between group"
              >
                <div>
                  <div className="font-bold text-slate-900 group-hover:text-[#6376DA] transition-colors">{p.name}</div>
                  <div className="text-xs text-slate-400 mt-1">Last updated {p.updatedAt ? format(p.updatedAt.toDate(), 'MMM d') : 'recently'}</div>
                </div>
                <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-[#6376DA] transition-all" />
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-500" /> Critical Alerts
          </h3>
          <div className="space-y-3">
            {alerts.overdue.length === 0 && alerts.upcoming.length === 0 ? (
              <div className="bg-emerald-50 p-8 rounded-2xl border border-emerald-100 text-center">
                <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                <p className="text-sm text-emerald-700 font-medium">All clear! No urgent tasks.</p>
              </div>
            ) : (
              <>
                {alerts.overdue.map(({ t, p }) => (
                  <div key={t.id} className="bg-red-50 p-4 rounded-2xl border border-red-100 flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                    <div>
                      <div className="text-sm font-bold text-red-900">{p.name}</div>
                      <div className="text-xs text-red-700 mt-0.5">Overdue: {t.text}</div>
                    </div>
                  </div>
                ))}
                {alerts.upcoming.map(({ t, p }) => (
                  <div key={t.id} className="bg-amber-50 p-4 rounded-2xl border border-amber-100 flex items-start gap-3">
                    <Clock className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                    <div>
                      <div className="text-sm font-bold text-amber-900">{p.name}</div>
                      <div className="text-xs text-amber-700 mt-0.5">Due soon: {t.text} ({friendly(t.dueDate)})</div>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function ProjectCalendar({ project, tasks, meetings }: { project: Project, tasks: Task[], meetings: Meeting[] }) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  
  const days = useMemo(() => {
    const start = startOfMonth(currentMonth);
    const end = endOfMonth(currentMonth);
    return eachDayOfInterval({ start, end });
  }, [currentMonth]);

  return (
    <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-6 border-b border-slate-100 flex items-center justify-between">
        <h3 className="text-lg font-bold text-slate-900">{format(currentMonth, 'MMMM yyyy')}</h3>
        <div className="flex gap-2">
          <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="p-2 hover:bg-slate-100 rounded-lg">
            <ChevronRight className="w-5 h-5 rotate-180" />
          </button>
          <button onClick={() => setCurrentMonth(new Date())} className="px-3 py-1 text-xs font-medium hover:bg-slate-100 rounded-lg">Today</button>
          <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="p-2 hover:bg-slate-100 rounded-lg">
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 border-b border-slate-100">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
          <div key={d} className="py-3 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 auto-rows-fr">
        {Array.from({ length: days[0].getDay() }).map((_, i) => (
          <div key={`empty-${i}`} className="min-h-[120px] border-r border-b border-slate-50 bg-slate-50/30" />
        ))}
        {days.map(day => {
          const dayTasks = tasks.filter(t => t.dueDate && isSameDay(parseISO(t.dueDate), day));
          const dayMeetings = meetings.filter(m => m.date && isSameDay(parseISO(m.date), day));
          
          return (
            <div key={day.toISOString()} className={cn(
              "min-h-[120px] p-2 border-r border-b border-slate-100 transition-colors hover:bg-slate-50/50",
              isToday(day) && "bg-[#6376DA]/5"
            )}>
              <div className={cn(
                "w-7 h-7 flex items-center justify-center text-xs font-bold rounded-full mb-2",
                isToday(day) ? "bg-[#6376DA] text-white" : "text-slate-400"
              )}>
                {format(day, 'd')}
              </div>
              <div className="space-y-1">
                {dayTasks.map(t => (
                  <div key={t.id} className="px-2 py-1 bg-slate-100 rounded text-[10px] font-medium text-slate-600 truncate">
                    {t.text}
                  </div>
                ))}
                {dayMeetings.map(m => (
                  <div key={m.id} className="px-2 py-1 bg-indigo-100 rounded text-[10px] font-bold text-indigo-700 truncate">
                    🤝 {m.title}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AllTeamsCalendar({ projects, tasks, members, brands, meetings }: { projects: Project[], tasks: Task[], members: Member[], brands: Brand[], meetings: Meeting[] }) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  
  const days = useMemo(() => {
    const start = startOfMonth(currentMonth);
    const end = endOfMonth(currentMonth);
    return eachDayOfInterval({ start, end });
  }, [currentMonth]);

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">All Teams Calendar</h2>
          <p className="text-sm text-slate-500">Cross-project timeline and deadlines.</p>
        </div>
        <div className="flex gap-4">
          <div className="flex bg-white border border-slate-200 p-1 rounded-xl shadow-sm">
            <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="p-2 hover:bg-slate-50 rounded-lg transition-colors">
              <ChevronRight className="w-5 h-5 rotate-180" />
            </button>
            <button onClick={() => setCurrentMonth(new Date())} className="px-4 py-1 text-xs font-bold text-slate-600 hover:text-[#6376DA] transition-colors">Today</button>
            <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="p-2 hover:bg-slate-50 rounded-lg transition-colors">
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">{format(currentMonth, 'MMMM yyyy')}</h3>
          <div className="flex gap-2">
            {members.map(m => (
              <div key={m.id} className="flex items-center gap-1.5 px-2 py-1 bg-slate-50 rounded-full border border-slate-100">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: m.color }} />
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{m.name}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-7 border-b border-slate-100">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
            <div key={d} className="py-3 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 auto-rows-fr">
          {Array.from({ length: days[0].getDay() }).map((_, i) => (
            <div key={`empty-${i}`} className="min-h-[140px] border-r border-b border-slate-50 bg-slate-50/30" />
          ))}
          {days.map(day => {
            const dayTasks = tasks.filter(t => t.dueDate && isSameDay(parseISO(t.dueDate), day));
            const dayMeetings = meetings.filter(m => m.date && isSameDay(parseISO(m.date), day));
            
            return (
              <div key={day.toISOString()} className={cn(
                "min-h-[140px] p-2 border-r border-b border-slate-100 transition-colors hover:bg-slate-50/50",
                isToday(day) && "bg-[#6376DA]/5"
              )}>
                <div className={cn(
                  "w-7 h-7 flex items-center justify-center text-xs font-bold rounded-full mb-2",
                  isToday(day) ? "bg-[#6376DA] text-white" : "text-slate-400"
                )}>
                  {format(day, 'd')}
                </div>
                <div className="space-y-1">
                  {dayTasks.map(t => {
                    const p = projects.find(proj => proj.id === t.projectId);
                    const m = members.find(mem => mem.id === p?.memberId);
                    return (
                      <div 
                        key={t.id} 
                        className="px-2 py-1 rounded text-[9px] font-bold text-white truncate shadow-sm"
                        style={{ backgroundColor: m?.color || '#6376DA' }}
                        title={`${p?.name}: ${t.text}`}
                      >
                        {t.text}
                      </div>
                    );
                  })}
                  {dayMeetings.map(m => (
                    <div key={m.id} className="px-2 py-1 bg-indigo-100 rounded text-[9px] font-bold text-indigo-700 truncate border border-indigo-200">
                      🤝 {m.title}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function GlobalTasks({ tasks, projects, brands }: { tasks: Task[], projects: Project[], brands: Brand[] }) {
  const openTasks = useMemo(() => {
    return tasks.filter(t => {
      const p = projects.find(proj => proj.id === t.projectId);
      return p && p.status === 'active' && t.progress !== 'completed';
    }).sort((a, b) => {
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    });
  }, [tasks, projects]);

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <header>
        <h2 className="text-2xl font-bold text-slate-900">My Global Tasks</h2>
        <p className="text-sm text-slate-500">All open tasks across your active projects.</p>
      </header>

      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden divide-y divide-slate-100">
        {openTasks.length === 0 ? (
          <div className="p-20 text-center">
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
            <h3 className="text-lg font-bold text-slate-900">All caught up!</h3>
            <p className="text-slate-400">You don't have any open tasks right now.</p>
          </div>
        ) : (
          openTasks.map(task => {
            const project = projects.find(p => p.id === task.projectId);
            const brand = brands.find(b => b.id === project?.brandId);
            const isOverdue = task.dueDate && task.dueDate < format(new Date(), 'yyyy-MM-dd');
            
            return (
              <div key={task.id} className="p-6 flex items-start gap-6 hover:bg-slate-50 transition-colors group">
                <div className={cn(
                  "mt-1 w-6 h-6 rounded-lg border-2 flex items-center justify-center shrink-0",
                  isOverdue ? "border-red-200 bg-red-50" : "border-slate-200 bg-white"
                )}>
                  {isOverdue ? <AlertCircle className="w-4 h-4 text-red-500" /> : <Circle className="w-4 h-4 text-slate-200" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <span className="text-base font-bold text-slate-900 truncate">{task.text}</span>
                    {task.dueDate && (
                      <span className={cn(
                        "text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0",
                        isOverdue ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-500"
                      )}>
                        {isOverdue ? 'Overdue' : `Due ${friendly(task.dueDate)}`}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <span className="font-medium text-slate-600">{brand?.name}</span>
                    <ChevronRight className="w-3 h-3 opacity-30" />
                    <span>{project?.name}</span>
                  </div>
                </div>
                <button 
                  onClick={() => {}} // Navigate to project
                  className="opacity-0 group-hover:opacity-100 p-2 hover:bg-slate-200 rounded-lg text-slate-400 transition-all"
                >
                  <ExternalLink className="w-5 h-5" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function friendly(iso: string) {
  if (!iso) return '';
  return format(parseISO(iso), 'MMM d, yyyy');
}
