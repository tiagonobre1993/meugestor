import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, 
  ReceiptText, 
  Wallet, 
  PieChart, 
  Plus, 
  Bell, 
  Search, 
  ChevronRight,
  ChevronDown,
  TrendingUp,
  TrendingDown,
  Calendar,
  MoreVertical,
  X,
  Settings,
  ArrowUpRight,
  ArrowDownRight,
  Trash2,
  LogOut,
  Shield,
  AlertCircle,
  Wand2,
  FileText,
  Clock
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart as RePieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  AreaChart,
  Area
} from 'recharts';
import { format, parseISO, subMonths, addMonths, startOfMonth, endOfMonth, isWithinInterval, isTomorrow, eachDayOfInterval, isSameDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { INITIAL_TRANSACTIONS, INITIAL_BUDGETS, INITIAL_BILLS, CATEGORIES } from './constants';
import { Transaction, Budget, Bill, Category } from './types';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { auth, db } from './firebase';
import { onAuthStateChanged, signOut, User as FirebaseUser } from 'firebase/auth';
import { 
  collection, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  query, 
  where, 
  orderBy,
  setDoc,
  getDoc,
  getDocs,
  getDocFromServer
} from 'firebase/firestore';
import { GoogleGenAI } from "@google/genai";
import { AuthScreen } from './components/Auth';
import { AdminPanel } from './components/AdminPanel';
import { ReportModal } from './components/ReportModal';
import { ErrorBoundary } from './components/ErrorBoundary';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [savingsGoal, setSavingsGoal] = useState<number>(8000);
  const [bills, setBills] = useState<Bill[]>([]);
  const [categories, setCategories] = useState<Category[]>(CATEGORIES);

  const [activeTab, setActiveTab] = useState<'dashboard' | 'transactions' | 'budgets'>('dashboard');
  const [transactionsFilter, setTransactionsFilter] = useState<'all' | 'income' | 'expense'>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isBillModalOpen, setIsBillModalOpen] = useState(false);
  const [modalInitialType, setModalInitialType] = useState<'income' | 'expense'>('expense');
  const [modalMode, setModalMode] = useState<'full' | 'income-only'>('full');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAdminPanelOpen, setIsAdminPanelOpen] = useState(false);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [confirmConfig, setConfirmConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    type: 'danger' | 'warning' | 'info';
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
    type: 'danger'
  });

  useEffect(() => {
    // Test Firestore Connection
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. The client is offline.");
        }
      }
    };
    testConnection();

    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (!u) {
        setLoading(false);
        // Clear data on logout
        setTransactions([]);
        setBudgets([]);
        setBills([]);
        setCategories(CATEGORIES);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    // Sync User Profile
    const userRef = doc(db, 'users', user.uid);
    const unsubProfile = onSnapshot(userRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setUserProfile(data);
        if (data.savingsGoal) setSavingsGoal(data.savingsGoal);
      }
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
      setLoading(false);
    });

    // Sync Transactions
    const transRef = collection(db, 'users', user.uid, 'transactions');
    const qTrans = query(transRef, orderBy('date', 'desc'));
    const unsubTrans = onSnapshot(qTrans, (snapshot) => {
      setTransactions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${user.uid}/transactions`);
    });

    // Sync Budgets
    const budgetsRef = collection(db, 'users', user.uid, 'budgets');
    const unsubBudgets = onSnapshot(budgetsRef, (snapshot) => {
      setBudgets(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${user.uid}/budgets`);
    });

    // Sync Bills
    const billsRef = collection(db, 'users', user.uid, 'bills');
    const unsubBills = onSnapshot(billsRef, (snapshot) => {
      setBills(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Bill)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${user.uid}/bills`);
    });

    // Sync Categories
    const catsRef = collection(db, 'users', user.uid, 'categories');
    const unsubCats = onSnapshot(catsRef, (snapshot) => {
      if (snapshot.empty) {
        setCategories(CATEGORIES);
      } else {
        setCategories(snapshot.docs.map(doc => doc.data().name));
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${user.uid}/categories`);
    });

    return () => {
      unsubProfile();
      unsubTrans();
      unsubBudgets();
      unsubBills();
      unsubCats();
    };
  }, [user]);

  const totalBalance = transactions.reduce((acc, t) => t.type === 'income' ? acc + t.amount : acc - t.amount, 0);
  const monthlySpending = transactions
    .filter(t => t.type === 'expense' && parseISO(t.date) >= startOfMonth(new Date()))
    .reduce((acc, t) => acc + t.amount, 0);

  const addTransaction = async (t: Omit<Transaction, 'id'>) => {
    if (!user) return;
    try {
      await addDoc(collection(db, 'users', user.uid, 'transactions'), t);
      
      if (t.type === 'income') {
        const existingBudget = budgets.find(b => b.category === t.category);
        if (existingBudget) {
          const budgetRef = doc(db, 'users', user.uid, 'budgets', (existingBudget as any).id);
          await updateDoc(budgetRef, { spent: existingBudget.spent + t.amount });
        } else {
          await addDoc(collection(db, 'users', user.uid, 'budgets'), {
            category: t.category,
            limit: 0,
            spent: t.amount
          });
        }
      }
      setIsModalOpen(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `users/${user.uid}/transactions`);
    }
  };

  const updateTransaction = async (id: string, updatedData: Partial<Transaction>) => {
    if (!user) return;
    try {
      const transRef = doc(db, 'users', user.uid, 'transactions', id);
      await updateDoc(transRef, updatedData);
      setEditingTransaction(null);
      setIsModalOpen(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}/transactions/${id}`);
    }
  };

  const deleteTransaction = async (id: string) => {
    if (!user) return;
    setConfirmConfig({
      isOpen: true,
      title: 'Excluir Transação',
      message: 'Tem certeza que deseja excluir esta transação? Esta ação não pode ser desfeita.',
      type: 'danger',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'users', user.uid, 'transactions', id));
          setConfirmConfig(prev => ({ ...prev, isOpen: false }));
        } catch (error) {
          setConfirmConfig(prev => ({ ...prev, isOpen: false }));
          handleFirestoreError(error, OperationType.DELETE, `users/${user.uid}/transactions/${id}`);
        }
      }
    });
  };

  const addBill = async (b: Omit<Bill, 'id'>) => {
    if (!user) return;
    try {
      await addDoc(collection(db, 'users', user.uid, 'bills'), b);
      setIsBillModalOpen(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `users/${user.uid}/bills`);
    }
  };

  const payBill = async (bill: Bill) => {
    if (!user) return;
    try {
      // 1. Update bill status or next month if recurring
      const billRef = doc(db, 'users', user.uid, 'bills', bill.id);
      if (bill.recurring) {
        const nextMonthDate = addMonths(parseISO(bill.dueDate), 1).toISOString();
        await updateDoc(billRef, { 
          status: 'pending', 
          dueDate: nextMonthDate 
        });
      } else {
        await updateDoc(billRef, { status: 'paid' });
      }

      // 2. Add as transaction
      await addDoc(collection(db, 'users', user.uid, 'transactions'), {
        description: `Pagamento: ${bill.name}`,
        amount: bill.amount,
        date: new Date().toISOString(),
        category: bill.category || 'Geral',
        type: 'expense'
      });
      
      // 3. Update budget if applicable
      const existingBudget = budgets.find(b => b.category === (bill.category || 'Geral'));
      if (existingBudget) {
        const budgetRef = doc(db, 'users', user.uid, 'budgets', (existingBudget as any).id);
        await updateDoc(budgetRef, { spent: existingBudget.spent + bill.amount });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}/bills/${bill.id}`);
    }
  };

  const handleLogout = () => {
    signOut(auth);
  };

  const updateSavingsGoal = async (goal: number) => {
    if (!user) return;
    try {
      await updateDoc(doc(db, 'users', user.uid), { savingsGoal: goal });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  const updateBudgets = async (newBudgets: Budget[]) => {
    if (!user) return;
    try {
      // This is a bit complex because we need to match existing docs
      for (const b of newBudgets) {
        const existing = budgets.find(eb => eb.category === b.category);
        if (existing) {
          await updateDoc(doc(db, 'users', user.uid, 'budgets', (existing as any).id), { limit: b.limit });
        } else {
          await addDoc(collection(db, 'users', user.uid, 'budgets'), b);
        }
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}/budgets`);
    }
  };

  const addCategory = async (name: string) => {
    if (!user) return;
    try {
      await addDoc(collection(db, 'users', user.uid, 'categories'), { name });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `users/${user.uid}/categories`);
    }
  };

  const fixIncomeCategories = async () => {
    if (!user) return;
    const incomeToFix = transactions.filter(t => t.type === 'income' && t.category === 'Alimentação');
    if (incomeToFix.length === 0) {
      alert("Nenhuma receita com categoria 'Alimentação' encontrada.");
      return;
    }

    let fixedCount = 0;
    for (const t of incomeToFix) {
      try {
        await updateDoc(doc(db, 'users', user.uid, 'transactions', t.id), { category: 'Salário' });
        fixedCount++;
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}/transactions/${t.id}`);
      }
    }
    alert(`${fixedCount} receitas foram corrigidas para a categoria 'Salário'.`);
  };

  const removeCategory = async (name: string) => {
    if (!user) return;
    try {
      const catSnap = await getDocs(query(collection(db, 'users', user.uid, 'categories'), where('name', '==', name)));
      catSnap.forEach(async (d) => await deleteDoc(doc(db, 'users', user.uid, 'categories', d.id)));
      
      const budgetSnap = await getDocs(query(collection(db, 'users', user.uid, 'budgets'), where('category', '==', name)));
      budgetSnap.forEach(async (d) => await deleteDoc(doc(db, 'users', user.uid, 'budgets', d.id)));
    } catch (error) {
      console.error("Error removing category:", error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-12 h-12 border-4 border-indigo-600/30 border-t-indigo-600 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <ErrorBoundary>
        <AuthScreen onAuthSuccess={setUser} />
      </ErrorBoundary>
    );
  }

  if (userProfile && userProfile.status === 'pending') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl shadow-xl border border-slate-100 w-full max-w-md p-8 text-center animate-in fade-in zoom-in duration-300">
          <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Clock size={32} />
          </div>
          <h2 className="text-2xl font-bold text-slate-800 mb-2">Aguardando Aprovação</h2>
          <p className="text-slate-500 mb-8">
            Olá, <strong>{userProfile.name || user.email}</strong>! Sua conta foi criada com sucesso, mas ainda precisa ser aprovada por um administrador para que você possa acessar o sistema.
          </p>
          <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100 mb-8">
            <p className="text-xs text-amber-800 leading-relaxed">
              Você receberá acesso assim que o administrador validar sua solicitação. Por favor, tente novamente mais tarde.
            </p>
          </div>
          <button 
            onClick={handleLogout}
            className="w-full py-4 bg-slate-100 text-slate-700 font-bold rounded-2xl hover:bg-slate-200 transition-all flex items-center justify-center gap-2"
          >
            <LogOut size={20} />
            Sair da Conta
          </button>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold">
                $
              </div>
              <span className="text-xl font-bold tracking-tight text-slate-800">Caxixola Ca$h</span>
            </div>
            
            <nav className="hidden md:flex space-x-8">
              <button 
                onClick={() => setActiveTab('dashboard')}
                className={cn(
                  "px-3 py-2 text-sm font-medium transition-colors border-b-2",
                  activeTab === 'dashboard' ? "text-indigo-600 border-indigo-600" : "text-slate-500 border-transparent hover:text-indigo-600"
                )}
              >
                Dashboard
              </button>
              <button 
                onClick={() => {
                  setTransactionsFilter('all');
                  setActiveTab('transactions');
                }}
                className={cn(
                  "px-3 py-2 text-sm font-medium transition-colors border-b-2",
                  activeTab === 'transactions' ? "text-indigo-600 border-indigo-600" : "text-slate-500 border-transparent hover:text-indigo-600"
                )}
              >
                Transações
              </button>
              <button 
                onClick={() => setActiveTab('budgets')}
                className={cn(
                  "px-3 py-2 text-sm font-medium transition-colors border-b-2",
                  activeTab === 'budgets' ? "text-indigo-600 border-indigo-600" : "text-slate-500 border-transparent hover:text-indigo-600"
                )}
              >
                Metas de Receita
              </button>
            </nav>

            <div className="flex items-center gap-4">
              {userProfile?.role === 'admin' && (
                <button 
                  onClick={() => setIsAdminPanelOpen(true)}
                  className="p-2 text-rose-500 hover:bg-rose-50 rounded-lg transition-colors"
                  title="Painel Admin"
                >
                  <Shield size={20} />
                </button>
              )}
              <button 
                onClick={() => setIsReportOpen(true)}
                className="p-2 text-slate-400 hover:text-indigo-600 transition-colors"
                title="Relatório Financeiro"
              >
                <FileText size={20} />
              </button>
              <button 
                onClick={() => setIsSettingsOpen(true)}
                className="p-2 text-slate-400 hover:text-indigo-600 transition-colors"
              >
                <Settings size={20} />
              </button>
              <button 
                onClick={handleLogout}
                className="p-2 text-slate-400 hover:text-rose-600 transition-colors"
                title="Sair"
              >
                <LogOut size={20} />
              </button>
              <button 
                onClick={() => {
                  setEditingTransaction(null);
                  setModalMode('full');
                  setIsModalOpen(true);
                }}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2"
              >
                <Plus size={18} />
                <span className="hidden sm:inline">Nova Transação</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'dashboard' && (
          <DashboardView 
            transactions={transactions} 
            budgets={budgets} 
            bills={bills}
            totalBalance={totalBalance}
            monthlySpending={monthlySpending}
            savingsGoal={savingsGoal}
            onAddTransaction={() => {
              setEditingTransaction(null);
              setModalInitialType('expense');
              setModalMode('expense-only');
              setIsModalOpen(true);
            }}
            onAddBill={() => setIsBillModalOpen(true)}
            onPayBill={payBill}
          />
        )}
        {activeTab === 'transactions' && (
          <TransactionsView 
            transactions={transactions} 
            initialType={transactionsFilter}
            onEdit={(t: Transaction) => {
              setEditingTransaction(t);
              setModalMode('full');
              setIsModalOpen(true);
            }}
            onDelete={deleteTransaction}
          />
        )}
        {activeTab === 'budgets' && (
          <BudgetsView 
            budgets={budgets} 
            transactions={transactions} 
            onAddTransaction={() => {
              setEditingTransaction(null);
              setModalInitialType('income');
              setModalMode('income-only');
              setIsModalOpen(true);
            }}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onOpenReport={() => setIsReportOpen(true)}
            onViewTransactions={(type: 'all' | 'income' | 'expense') => {
              setTransactionsFilter(type);
              setActiveTab('transactions');
            }}
            onFixCategories={() => {
              setConfirmConfig({
                isOpen: true,
                title: 'Corrigir Categorias',
                message: "Deseja corrigir todas as receitas que estão marcadas como 'Alimentação' para a categoria 'Salário'?",
                type: 'warning',
                onConfirm: async () => {
                  await fixIncomeCategories();
                  setConfirmConfig(prev => ({ ...prev, isOpen: false }));
                }
              });
            }}
          />
        )}
      </main>

      {isModalOpen && (
        <TransactionModal 
          onClose={() => {
            setIsModalOpen(false);
            setEditingTransaction(null);
          }} 
          onSubmit={(data: any) => {
            if (editingTransaction) {
              updateTransaction(editingTransaction.id, data);
            } else {
              addTransaction(data);
            }
          }}
          categories={categories}
          onAddCategory={addCategory}
          initialType={modalInitialType}
          mode={modalMode}
          initialData={editingTransaction}
        />
      )}

      {isBillModalOpen && (
        <BillModal 
          onClose={() => setIsBillModalOpen(false)} 
          onSubmit={addBill}
        />
      )}

      {isSettingsOpen && (
        <SettingsModal
          onClose={() => setIsSettingsOpen(false)}
          savingsGoal={savingsGoal}
          setSavingsGoal={updateSavingsGoal}
          budgets={budgets}
          setBudgets={updateBudgets}
          categories={categories}
          onAddCategory={addCategory}
          onRemoveCategory={removeCategory}
        />
      )}

      {isAdminPanelOpen && (
        <AdminPanel onClose={() => setIsAdminPanelOpen(false)} />
      )}

      {isReportOpen && (
        <ReportModal 
          isOpen={isReportOpen} 
          onClose={() => setIsReportOpen(false)} 
          transactions={transactions}
          budgets={budgets}
          categories={categories}
        />
      )}

      {confirmConfig.isOpen && (
        <ConfirmationModal 
          title={confirmConfig.title}
          message={confirmConfig.message}
          type={confirmConfig.type}
          onConfirm={confirmConfig.onConfirm}
          onCancel={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}
        />
      )}

      <footer className="py-8 border-t border-slate-200 text-center text-slate-500 text-sm">
        <p>© 2026 Caxixola Ca$h. Todos os direitos reservados.</p>
        <p className="mt-1 opacity-60">Logado como: {user.email}</p>
      </footer>
    </div>
    </ErrorBoundary>
  );
}

function SmartInsight({ transactions, budgets, bills, savingsGoal, totalBalance }: any) {
  const [insight, setInsight] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const generateInsight = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      const model = "gemini-3-flash-preview";
      
      const currentMonth = new Date().getMonth();
      const currentYear = new Date().getFullYear();
      
      const monthlyTransactions = transactions.filter((t: any) => {
        const d = parseISO(t.date);
        return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
      });

      const income = monthlyTransactions.filter((t: any) => t.type === 'income').reduce((acc: number, t: any) => acc + t.amount, 0);
      const expenses = monthlyTransactions.filter((t: any) => t.type === 'expense').reduce((acc: number, t: any) => acc + t.amount, 0);
      
      const topCategories = monthlyTransactions
        .filter((t: any) => t.type === 'expense')
        .reduce((acc: any, t: any) => {
          acc[t.category] = (acc[t.category] || 0) + t.amount;
          return acc;
        }, {});
      
      const sortedCategories = Object.entries(topCategories)
        .sort(([, a]: any, [, b]: any) => b - a)
        .slice(0, 3)
        .map(([name, value]) => `${name}: R$ ${value}`)
        .join(", ");

      const overBudget = budgets.filter((b: any) => b.spent > b.limit && b.limit > 0).map((b: any) => b.category).join(", ");
      
      const pendingBills = bills.filter((b: any) => b.status === 'pending').length;

      const prompt = `
        Você é um consultor financeiro pessoal experiente. Analise os dados financeiros do usuário deste mês e forneça um diagnóstico curto (máximo 3 frases), preciso e acionável em Português do Brasil.
        
        Dados do Mês Atual:
        - Receita Total: R$ ${income}
        - Despesas Totais: R$ ${expenses}
        - Saldo Atual: R$ ${totalBalance}
        - Meta de Economia: R$ ${savingsGoal}
        - Top 3 Categorias de Gasto: ${sortedCategories}
        - Orçamentos Estourados: ${overBudget || "Nenhum"}
        - Contas Pendentes: ${pendingBills}
        
        Seja direto, motivador e aponte onde o usuário pode melhorar ou o que ele está fazendo bem.
      `;

      const response = await ai.models.generateContent({
        model,
        contents: prompt,
      });

      setInsight(response.text || "Não foi possível gerar um insight no momento.");
    } catch (error) {
      console.error("Erro ao gerar insight:", error);
      setInsight("Houve um erro ao analisar seus dados. Tente novamente mais tarde.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (transactions.length > 0) {
      generateInsight();
    }
  }, [transactions.length, budgets.length, bills.length]);

  return (
    <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-6">
      <h3 className="text-lg font-bold text-indigo-900 mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp size={20} />
          Insight Inteligente
        </div>
        {loading && <div className="w-4 h-4 border-2 border-indigo-600/30 border-t-indigo-600 rounded-full animate-spin"></div>}
      </h3>
      <p className="text-indigo-800 opacity-80 text-sm leading-relaxed mb-4">
        {insight || "Analisando seus dados financeiros para gerar um diagnóstico..."}
      </p>
      <div className="flex gap-2">
        <button 
          onClick={generateInsight}
          disabled={loading}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2"
        >
          <Wand2 size={16} />
          {loading ? "Analisando..." : "Atualizar Insight"}
        </button>
      </div>
    </div>
  );
}

function MonthlyExpenseLineChart({ transactions }: { transactions: Transaction[] }) {
  const [selectedDate, setSelectedDate] = useState(new Date());

  const handlePrevMonth = () => setSelectedDate(subMonths(selectedDate, 1));
  const handleNextMonth = () => setSelectedDate(addMonths(selectedDate, 1));

  const monthStart = startOfMonth(selectedDate);
  const monthEnd = endOfMonth(selectedDate);
  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });

  const chartData = daysInMonth.map(day => {
    const dailyExpenses = transactions
      .filter(t => t.type === 'expense' && isSameDay(parseISO(t.date), day))
      .reduce((sum, t) => sum + t.amount, 0);
    
    return {
      day: format(day, 'dd'),
      fullDate: format(day, "dd 'de' MMMM", { locale: ptBR }),
      amount: dailyExpenses
    };
  });

  const totalMonthExpense = chartData.reduce((sum, d) => sum + d.amount, 0);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  };

  return (
    <div className="card p-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
        <div>
          <h3 className="text-lg font-bold text-slate-800">Evolução de Gastos</h3>
          <p className="text-sm text-slate-500">Acompanhe seus gastos diários no mês</p>
        </div>
        
        <div className="flex items-center gap-3 bg-slate-50 p-1.5 rounded-xl border border-slate-100">
          <button 
            onClick={handlePrevMonth}
            className="p-2 hover:bg-white hover:shadow-sm rounded-lg transition-all text-slate-600"
          >
            <ChevronRight className="rotate-180" size={18} />
          </button>
          <div className="px-4 py-1 text-sm font-bold text-slate-700 min-w-[140px] text-center capitalize">
            {format(selectedDate, 'MMMM yyyy', { locale: ptBR })}
          </div>
          <button 
            onClick={handleNextMonth}
            className="p-2 hover:bg-white hover:shadow-sm rounded-lg transition-all text-slate-600"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        <div className="lg:col-span-3 h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis 
                dataKey="day" 
                axisLine={false} 
                tickLine={false} 
                tick={{ fill: '#94a3b8', fontSize: 12 }}
                interval="preserveStartEnd"
              />
              <YAxis 
                hide 
              />
              <Tooltip 
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    return (
                      <div className="bg-white p-3 rounded-xl shadow-xl border border-slate-100">
                        <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">{payload[0].payload.fullDate}</p>
                        <p className="text-sm font-bold text-indigo-600">{formatCurrency(payload[0].value as number)}</p>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Line 
                type="monotone" 
                dataKey="amount" 
                stroke="#6366f1" 
                strokeWidth={3} 
                dot={{ r: 4, fill: '#6366f1', strokeWidth: 2, stroke: '#fff' }}
                activeDot={{ r: 6, strokeWidth: 0 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="flex flex-col justify-center p-6 bg-slate-50 rounded-2xl border border-slate-100">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Total no Período</p>
          <h4 className="text-2xl font-black text-slate-800 mb-4">{formatCurrency(totalMonthExpense)}</h4>
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <div className="w-2 h-2 rounded-full bg-indigo-500"></div>
              <span>Média diária: {formatCurrency(totalMonthExpense / daysInMonth.length)}</span>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">
              Este gráfico mostra como suas despesas se distribuíram ao longo do mês selecionado.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function DashboardView({ transactions, budgets, bills, totalBalance, monthlySpending, savingsGoal, onAddTransaction, onAddBill, onPayBill }: any) {
  const pendingBills = (bills || []).filter((b: any) => {
    const dueDate = parseISO(b.dueDate);
    const isCurrentMonth = dueDate.getMonth() === new Date().getMonth() && dueDate.getFullYear() === new Date().getFullYear();
    return b.status === 'pending' && isCurrentMonth;
  });

  const categoryData = transactions
    .filter((t: any) => t.type === 'expense')
    .reduce((acc: any[], t: any) => {
      const existing = acc.find(item => item.name === t.category);
      if (existing) {
        existing.value += t.amount;
      } else {
        acc.push({ name: t.category, value: t.amount });
      }
      return acc;
    }, [])
    .sort((a: any, b: any) => b.value - a.value);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  };

  const formatDate = (dateStr: string) => {
    try {
      return format(parseISO(dateStr), 'dd/MM/yyyy');
    } catch (e) {
      return dateStr;
    }
  };

  const COLORS = [
    '#6366f1', // Indigo
    '#f59e0b', // Amber
    '#10b981', // Emerald
    '#ef4444', // Red
    '#8b5cf6', // Violet
    '#ec4899', // Pink
    '#06b6d4', // Cyan
    '#f97316', // Orange
  ];

  const totalCategoryValue = categoryData.reduce((acc: number, curr: any) => acc + curr.value, 0);

  return (
    <div className="space-y-8">
      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-indigo-600 rounded-2xl p-6 text-white shadow-lg shadow-indigo-200">
          <p className="text-indigo-100 text-sm font-medium mb-1">Saldo Total</p>
          <h2 className="text-3xl font-bold mb-4">{formatCurrency(totalBalance)}</h2>
          <div className="flex items-center text-xs bg-white/10 w-fit px-2 py-1 rounded-full">
            <ArrowUpRight size={12} className="mr-1" />
            <span className="mr-1">2.4%</span>
            <span className="opacity-80">desde o mês passado</span>
          </div>
        </div>

        <div className="card p-6">
          <p className="text-slate-500 text-sm font-medium mb-1">Gastos Mensais</p>
          <h2 className="text-3xl font-bold text-slate-800 mb-4">{formatCurrency(monthlySpending)}</h2>
          <div className="flex items-center text-xs text-red-500 font-semibold">
            <ArrowUpRight size={12} className="mr-1" />
            <span className="mr-1">12.5%</span>
            <span className="text-slate-400 font-normal ml-1">acima do normal</span>
          </div>
        </div>

        <div className="card p-6">
          <div className="flex justify-between items-start mb-1">
            <p className="text-slate-500 text-sm font-medium">Meta de Economia</p>
            <span className="text-xs font-bold text-indigo-600">
              {Math.min(Math.round((totalBalance / savingsGoal) * 100), 100)}%
            </span>
          </div>
          <h2 className="text-3xl font-bold text-slate-800 mb-4">{formatCurrency(savingsGoal)}</h2>
          <div className="w-full bg-slate-100 rounded-full h-2">
            <div 
              className="bg-indigo-500 h-2 rounded-full transition-all duration-500" 
              style={{ width: `${Math.min((totalBalance / savingsGoal) * 100, 100)}%` }}
            ></div>
          </div>
        </div>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 gap-8">
        <MonthlyExpenseLineChart transactions={transactions} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-3 card p-8">
          <h3 className="text-xl font-bold text-slate-800 mb-8 flex items-center gap-2">
            <div className="w-2 h-6 bg-indigo-600 rounded-full"></div>
            Gastos por Categoria
          </h3>
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-10">
            <div className="lg:col-span-3 h-[350px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={categoryData}
                  margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
                >
                  <defs>
                    <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6366f1" stopOpacity={0.8}/>
                      <stop offset="100%" stopColor="#6366f1" stopOpacity={0.3}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis 
                    dataKey="name" 
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: '#64748b', fontSize: 12, fontWeight: 600 }}
                    dy={10}
                  />
                  <YAxis 
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    tickFormatter={(value) => `R$ ${value}`}
                  />
                  <Tooltip 
                    cursor={{ fill: '#f8fafc', radius: 10 }}
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        return (
                          <div className="bg-white p-4 shadow-2xl rounded-2xl border border-slate-100 animate-in fade-in zoom-in duration-200">
                            <p className="text-xs font-bold text-slate-400 uppercase mb-1">{payload[0].payload.name}</p>
                            <p className="text-lg font-bold text-indigo-600">{formatCurrency(payload[0].value as number)}</p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Bar 
                    dataKey="value" 
                    radius={[10, 10, 0, 0]} 
                    barSize={40}
                  >
                    {categoryData.map((entry: any, index: number) => (
                      <Cell 
                        key={`cell-${index}`} 
                        fill={COLORS[index % COLORS.length]} 
                        fillOpacity={0.9}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="lg:col-span-2 flex flex-col justify-center">
              <div className="space-y-4 max-h-[350px] overflow-y-auto pr-4 custom-scrollbar">
                {categoryData.map((item: any, index: number) => {
                  const percentage = ((item.value / totalCategoryValue) * 100).toFixed(1);
                  return (
                    <div key={item.name} className="group flex flex-col gap-2 p-4 bg-slate-50 hover:bg-white hover:shadow-md transition-all rounded-2xl border border-transparent hover:border-slate-100">
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-xl flex items-center justify-center text-white shadow-sm" style={{ backgroundColor: COLORS[index % COLORS.length] }}>
                            <span className="text-[10px] font-bold">{item.name.substring(0, 2).toUpperCase()}</span>
                          </div>
                          <span className="text-slate-700 font-bold">{item.name}</span>
                        </div>
                        <span className="font-bold text-slate-900">{formatCurrency(item.value)}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex-1 bg-slate-200 rounded-full h-1.5 overflow-hidden">
                          <div 
                            className="h-full rounded-full transition-all duration-1000" 
                            style={{ 
                              width: `${percentage}%`,
                              backgroundColor: COLORS[index % COLORS.length]
                            }}
                          ></div>
                        </div>
                        <span className="text-[10px] font-black text-slate-400 w-8">{percentage}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="card overflow-hidden">
          <div className="p-6 border-b border-slate-100 flex justify-between items-center">
            <h3 className="text-lg font-bold text-slate-800">Próximas Contas</h3>
            <div className="flex items-center gap-3">
              <button 
                onClick={onAddBill}
                className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition-colors"
                title="Adicionar Conta"
              >
                <Plus size={18} />
              </button>
              <button className="text-indigo-600 text-sm font-semibold hover:underline">Ver Tudo</button>
            </div>
          </div>
          <div className="divide-y divide-slate-100">
            {pendingBills.length === 0 ? (
              <div className="p-8 text-center text-slate-400">
                <Calendar size={32} className="mx-auto mb-2 opacity-20" />
                <p className="text-sm">Nenhuma conta pendente para este mês.</p>
              </div>
            ) : pendingBills.map((bill: any) => {
              const isDueTomorrow = isTomorrow(parseISO(bill.dueDate));
              return (
                <div key={bill.id} className="p-6 flex items-center justify-between hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-slate-50 rounded-lg flex items-center justify-center text-slate-600 relative">
                      <Calendar size={20} />
                      {isDueTomorrow && (
                        <div className="absolute -top-1 -right-1 text-orange-500 bg-white rounded-full">
                          <AlertCircle size={14} fill="currentColor" className="text-white" />
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-slate-800">{bill.name}</p>
                        {isDueTomorrow && (
                          <span className="flex items-center gap-1 text-[10px] font-bold text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded">
                            <AlertCircle size={10} />
                            VENCE AMANHÃ
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-slate-500">
                        Vence em {formatDate(bill.dueDate)}
                        {bill.installments && ` • Parcela ${bill.installments}`}
                      </p>
                    </div>
                  </div>
                  <div className="text-right flex flex-col items-end gap-2">
                    <p className="font-bold text-slate-800">{formatCurrency(bill.amount)}</p>
                    <div className="flex items-center gap-2">
                      {bill.status === 'pending' && (
                        <button 
                          onClick={() => onPayBill(bill)}
                          className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-green-50 text-green-600 hover:bg-green-100 transition-colors"
                        >
                          Pagar
                        </button>
                      )}
                      <span className={cn(
                        "text-[10px] uppercase font-bold px-2 py-0.5 rounded",
                        bill.status === 'pending' ? "text-orange-500 bg-orange-50" : "text-indigo-500 bg-indigo-50"
                      )}>
                        {bill.status === 'pending' ? 'Pendente' : bill.status === 'scheduled' ? 'Agendado' : 'Pago'}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-6">
          <SmartInsight 
            transactions={transactions} 
            budgets={budgets} 
            bills={bills} 
            savingsGoal={savingsGoal} 
            totalBalance={totalBalance} 
          />
        </div>
      </div>
    </div>
  );
}

function TransactionsView({ transactions, initialType = 'all', onEdit, onDelete }: any) {
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState(initialType);
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);

  const filteredTransactions = transactions.filter((t: any) => {
    const matchesSearch = t.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || t.category === categoryFilter;
    const matchesType = typeFilter === 'all' || t.type === typeFilter;
    return matchesSearch && matchesCategory && matchesType;
  });

  const totalPages = Math.ceil(filteredTransactions.length / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const currentTransactions = filteredTransactions.slice(startIndex, startIndex + pageSize);
  const endIndex = Math.min(startIndex + pageSize, filteredTransactions.length);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  };

  const formatDate = (dateStr: string) => {
    try {
      return format(parseISO(dateStr), 'dd/MM/yyyy');
    } catch (e) {
      return dateStr;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Histórico de Transações</h1>
          <p className="text-slate-500 text-sm mt-1">Monitore e gerencie todas as suas entradas e saídas.</p>
        </div>
      </div>

      <div className="card p-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div className="md:col-span-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input 
              type="text" 
              placeholder="Buscar descrição..." 
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
            />
          </div>
          <select 
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value);
              setCurrentPage(1);
            }}
            className="py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
          >
            <option value="all">Todos os Tipos</option>
            <option value="income">Receitas</option>
            <option value="expense">Despesas</option>
          </select>
          <select 
            value={categoryFilter}
            onChange={(e) => {
              setCategoryFilter(e.target.value);
              setCurrentPage(1);
            }}
            className="py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
          >
            <option value="all">Todas as Categorias</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <input type="date" className="py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm" />
          <input type="date" className="py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm" />
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Data</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Descrição</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Categoria</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Valor</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-center min-w-[80px]">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {currentTransactions.map((t: any, index: number) => (
                <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">{formatDate(t.date)}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900">{t.description}</td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={cn(
                      "px-2.5 py-0.5 rounded-full text-xs font-medium",
                      t.category === 'Alimentação' ? "bg-orange-100 text-orange-700" :
                      t.category === 'Salário' ? "bg-emerald-100 text-emerald-700" :
                      t.category === 'Entretenimento' ? "bg-purple-100 text-purple-700" :
                      t.category === 'Transporte' ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-700"
                    )}>
                      {t.category}
                    </span>
                  </td>
                  <td className={cn(
                    "px-6 py-4 whitespace-nowrap text-sm text-right font-semibold",
                    t.type === 'income' ? "text-emerald-600" : "text-red-600"
                  )}>
                    {t.type === 'income' ? '+' : '-'}{formatCurrency(t.amount)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-center relative">
                    <button 
                      onClick={() => setOpenDropdownId(openDropdownId === t.id ? null : t.id)}
                      className="text-slate-400 hover:text-slate-600 p-2 rounded-full hover:bg-slate-100 transition-colors"
                    >
                      <MoreVertical size={20} />
                    </button>
                    
                    {openDropdownId === t.id && (
                      <>
                        <div 
                          className="fixed inset-0 z-10" 
                          onClick={() => setOpenDropdownId(null)}
                        ></div>
                        <div className={cn(
                          "absolute right-0 w-40 bg-white rounded-xl shadow-xl border border-slate-100 py-2 z-20 animate-in fade-in zoom-in duration-200",
                          index >= currentTransactions.length - 2 && currentTransactions.length > 3 ? "bottom-full mb-2" : "mt-2"
                        )}>
                          <button 
                            onClick={() => {
                              onEdit(t);
                              setOpenDropdownId(null);
                            }}
                            className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2 transition-colors"
                          >
                            <TrendingUp size={16} className="text-indigo-500" />
                            Editar
                          </button>
                          <button 
                            onClick={() => {
                              onDelete(t.id);
                              setOpenDropdownId(null);
                            }}
                            className="w-full text-left px-4 py-2 text-sm text-rose-600 hover:bg-rose-50 flex items-center gap-2 transition-colors"
                          >
                            <Trash2 size={16} />
                            Excluir
                          </button>
                        </div>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-4 border-t border-slate-200 flex flex-col md:flex-row items-center justify-between bg-slate-50/50 gap-4">
          <div className="flex items-center gap-4">
            <div className="text-sm text-slate-500">
              Mostrando <span className="font-medium text-slate-900">{filteredTransactions.length > 0 ? startIndex + 1 : 0}</span> até <span className="font-medium text-slate-900">{endIndex}</span> de <span className="font-medium text-slate-900">{filteredTransactions.length}</span> resultados
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-500">Resultados por página:</span>
              <select 
                value={pageSize} 
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="text-sm border-slate-200 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 py-1"
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button 
              onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
              disabled={currentPage === 1}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors"
            >
              Anterior
            </button>
            <button 
              onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
              disabled={currentPage === totalPages || totalPages === 0}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              Próximo
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function BudgetsView({ budgets, transactions, onAddTransaction, onOpenSettings, onOpenReport, onViewTransactions, onFixCategories }: { 
  budgets: any[], 
  transactions: any[], 
  onAddTransaction: () => void, 
  onOpenSettings: () => void, 
  onOpenReport: () => void,
  onViewTransactions: (type: 'all' | 'income' | 'expense') => void,
  onFixCategories: () => void
}) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  };

  const totalReceived = transactions
    .filter((t: any) => t.type === 'income')
    .reduce((acc: number, t: any) => acc + t.amount, 0);
  const totalGoal = budgets.reduce((acc: number, b: any) => acc + b.limit, 0);
  const remaining = totalGoal - totalReceived;

  // Process transactions for the chart - Generate dynamic range of months
  const getIncomeHistory = () => {
    const incomeTransactions = transactions.filter((t: any) => t.type === 'income');
    
    if (incomeTransactions.length === 0) {
      return Array.from({ length: 12 }, (_, i) => {
        const d = subMonths(new Date(), 11 - i);
        return {
          name: format(d, 'MMM/yy', { locale: ptBR }).replace(/^\w/, (c) => c.toUpperCase()),
          monthKey: format(d, 'yyyy-MM'),
          value: 0
        };
      });
    }

    const dates = incomeTransactions.map((t: any) => parseISO(t.date));
    const minDate = new Date(Math.min(...dates.map(d => d.getTime())));
    const maxDate = new Date();

    let startDate = startOfMonth(subMonths(maxDate, 11));
    if (minDate < startDate) {
      startDate = startOfMonth(minDate);
    }

    // Limit to last 24 months for income history
    const twentyFourMonthsAgo = startOfMonth(subMonths(maxDate, 23));
    if (startDate < twentyFourMonthsAgo) {
      startDate = twentyFourMonthsAgo;
    }

    const months = [];
    let current = startDate;
    while (current <= maxDate) {
      months.push({
        name: format(current, 'MMM/yy', { locale: ptBR }).replace(/^\w/, (c) => c.toUpperCase()),
        monthKey: format(current, 'yyyy-MM'),
        value: 0
      });
      current = addMonths(current, 1);
    }

    incomeTransactions.forEach((t: any) => {
      const date = parseISO(t.date);
      const monthKey = format(date, 'yyyy-MM');
      const monthData = months.find(m => m.monthKey === monthKey);
      if (monthData) {
        monthData.value += t.amount;
      }
    });

    return months;
  };

  const incomeHistory = getIncomeHistory();

  return (
    <div className="space-y-8">
      <div className="bg-emerald-600 rounded-2xl p-8 text-white shadow-xl shadow-emerald-100">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <p className="text-emerald-100 font-medium mb-1">Progresso Total das Metas de Receita</p>
            <h2 className="text-4xl font-extrabold">{formatCurrency(totalReceived)} <span className="text-lg font-normal opacity-75">/ {formatCurrency(totalGoal)}</span></h2>
            <p className="mt-4 text-emerald-100 flex items-center gap-2">
              {totalReceived >= totalGoal ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
              {totalReceived >= totalGoal 
                ? `Parabéns! Você atingiu sua meta total de receita!` 
                : `Faltam ${formatCurrency(Math.max(0, remaining))} para atingir sua meta total.`}
            </p>
          </div>
          <div className="flex gap-3">
            <div className="relative flex">
              <button 
                onClick={onAddTransaction}
                className="bg-white text-emerald-600 px-6 py-3 rounded-l-xl font-semibold shadow-lg hover:bg-emerald-50 transition-all border-r border-emerald-100"
              >
                Adicionar Receita
              </button>
              <button 
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className="bg-white text-emerald-600 px-3 py-3 rounded-r-xl font-semibold shadow-lg hover:bg-emerald-50 transition-all"
              >
                <ChevronDown size={20} className={cn("transition-transform duration-200", isDropdownOpen && "rotate-180")} />
              </button>
              
              {isDropdownOpen && (
                <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-xl shadow-2xl border border-slate-100 py-2 z-50 animate-in fade-in zoom-in duration-200">
                  <button 
                    onClick={() => {
                      onOpenSettings();
                      setIsDropdownOpen(false);
                    }}
                    className="w-full text-left px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors"
                  >
                    <div className="w-8 h-8 bg-indigo-50 text-indigo-600 rounded-lg flex items-center justify-center">
                      <Settings size={18} />
                    </div>
                    <div>
                      <p className="font-bold text-slate-800">Editar Metas</p>
                      <p className="text-[10px] text-slate-500">Ajustar objetivos de receita</p>
                    </div>
                  </button>
                  <button 
                    onClick={() => {
                      onViewTransactions('income');
                      setIsDropdownOpen(false);
                    }}
                    className="w-full text-left px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors"
                  >
                    <div className="w-8 h-8 bg-slate-100 text-slate-600 rounded-lg flex items-center justify-center">
                      <ReceiptText size={18} />
                    </div>
                    <div>
                      <p className="font-bold text-slate-800">Editar Receitas</p>
                      <p className="text-[10px] text-slate-500">Gerenciar lançamentos individuais</p>
                    </div>
                  </button>
                  <div className="h-px bg-slate-100 my-1 mx-2"></div>
                  <button 
                    onClick={() => {
                      onFixCategories();
                      setIsDropdownOpen(false);
                    }}
                    className="w-full text-left px-4 py-3 text-sm text-amber-600 hover:bg-amber-50 flex items-center gap-3 transition-colors"
                  >
                    <div className="w-8 h-8 bg-amber-100 text-amber-600 rounded-lg flex items-center justify-center">
                      <Wand2 size={18} />
                    </div>
                    <div>
                      <p className="font-bold">Corrigir Categorias</p>
                      <p className="text-[10px] text-amber-500">Mudar 'Alimentação' para 'Salário'</p>
                    </div>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Income History Chart */}
      <div className="card p-8">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h3 className="text-xl font-bold text-slate-800">Histórico de Receitas</h3>
            <p className="text-sm text-slate-500">Evolução dos seus ganhos nos últimos meses</p>
          </div>
          <div className="flex items-center gap-2 text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full text-sm font-bold">
            <TrendingUp size={16} />
            <span>+12.5% este mês</span>
          </div>
        </div>
        
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={incomeHistory}>
              <defs>
                <linearGradient id="colorIncome" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis 
                dataKey="name" 
                axisLine={false} 
                tickLine={false} 
                tick={{ fill: '#94a3b8', fontSize: 12 }}
                dy={10}
                interval={0}
              />
              <YAxis 
                hide 
                domain={['auto', 'auto']}
              />
              <Tooltip 
                contentStyle={{ 
                  borderRadius: '16px', 
                  border: 'none', 
                  boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
                  padding: '12px'
                }}
                formatter={(value: number) => [formatCurrency(value), 'Receita']}
              />
              <Area 
                type="monotone" 
                dataKey="value" 
                stroke="#10b981" 
                strokeWidth={3}
                fillOpacity={1} 
                fill="url(#colorIncome)" 
                animationDuration={1500}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {budgets.map((b: any) => {
          const percent = b.limit > 0 ? Math.min((b.spent / b.limit) * 100, 100) : 0;
          const isReached = b.spent >= b.limit && b.limit > 0;

          return (
            <div key={b.category} className="card p-4 group hover:shadow-md transition-shadow flex flex-col">
              <div className="flex justify-between items-start mb-4">
                <div className={cn(
                  "p-2 rounded-lg",
                  b.category === 'Salário' ? "bg-emerald-100 text-emerald-600" :
                  b.category === 'Vendas' ? "bg-blue-100 text-blue-600" :
                  b.category === 'Investimentos' ? "bg-purple-100 text-purple-600" : "bg-indigo-100 text-indigo-600"
                )}>
                  <TrendingUp size={20} />
                </div>
                <button 
                  onClick={onOpenSettings}
                  className="text-slate-400 hover:text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] font-medium"
                >
                  Editar
                </button>
              </div>
              <div className="mb-3">
                <h3 className="text-base font-bold text-slate-800 leading-tight">{b.category}</h3>
                <p className="text-[11px] text-slate-500 line-clamp-1">Meta para {b.category.toLowerCase()}</p>
              </div>
              <div className="mt-auto">
                <div className="flex justify-between items-end mb-1.5">
                  <div className="flex flex-col">
                    <span className="text-lg font-bold text-slate-800 leading-none">{formatCurrency(b.spent)}</span>
                    <span className="text-[10px] text-slate-400 mt-1">Meta: {formatCurrency(b.limit)}</span>
                  </div>
                  <span className={cn(
                    "text-[10px] font-bold px-1.5 py-0.5 rounded",
                    isReached ? "text-emerald-600 bg-emerald-50" : "text-indigo-600 bg-indigo-50"
                  )}>
                    {isReached ? 'OK' : `${Math.round(percent)}%`}
                  </span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                  <div 
                    className={cn("h-full rounded-full transition-all duration-1000", isReached ? "bg-emerald-500" : "bg-indigo-500")} 
                    style={{ width: `${percent}%` }}
                  ></div>
                </div>
              </div>
            </div>
          );
        })}
        <button 
          onClick={onOpenSettings}
          className="border-2 border-dashed border-slate-300 rounded-2xl p-4 flex flex-col items-center justify-center text-slate-400 hover:border-emerald-600 hover:text-emerald-600 hover:bg-emerald-50 transition-all group"
        >
          <div className="bg-slate-100 group-hover:bg-emerald-100 p-3 rounded-full mb-2 transition-colors">
            <Plus size={24} />
          </div>
          <span className="font-bold text-sm">Nova Meta</span>
        </button>
      </div>
    </div>
  );
}

function SettingsModal({ onClose, savingsGoal, setSavingsGoal, budgets, setBudgets, categories, onAddCategory, onRemoveCategory }: any) {
  const [localSavingsGoal, setLocalSavingsGoal] = useState(savingsGoal);
  const [newCategoryName, setNewCategoryName] = useState('');
  
  // Create a map of existing budgets for easy lookup
  const initialBudgetMap = budgets.reduce((acc: any, b: any) => {
    acc[b.category] = b.limit;
    return acc;
  }, {});

  const [localLimits, setLocalLimits] = useState<{ [key: string]: number }>(() => {
    const limits: { [key: string]: number } = {};
    categories.forEach((cat: string) => {
      limits[cat] = initialBudgetMap[cat] || 0;
    });
    return limits;
  });

  const handleLimitChange = (category: string, limit: string) => {
    setLocalLimits(prev => ({
      ...prev,
      [category]: parseFloat(limit) || 0
    }));
  };

  const handleAddCategory = () => {
    if (newCategoryName.trim() && !categories.includes(newCategoryName.trim())) {
      const name = newCategoryName.trim();
      onAddCategory(name);
      setLocalLimits(prev => ({ ...prev, [name]: 0 }));
      setNewCategoryName('');
    }
  };

  const handleRemoveCategory = (category: string) => {
    onRemoveCategory(category);
    setLocalLimits(prev => {
      const newLimits = { ...prev };
      delete newLimits[category];
      return newLimits;
    });
  };

  const handleSave = () => {
    setSavingsGoal(localSavingsGoal);
    
    // Convert limits back to Budget objects
    const newBudgets = Object.entries(localLimits).map(([category, limit]) => {
      const existingBudget = budgets.find((b: any) => b.category === category);
      return {
        category,
        limit,
        spent: existingBudget ? existingBudget.spent : 0
      };
    });
    
    setBudgets(newBudgets);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-xl border border-slate-100 w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-200">
        <header className="px-8 pt-8 pb-4 flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-800">Configurações</h1>
            <p className="text-sm text-slate-500 mt-1">Ajuste suas metas de economia e receita.</p>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 transition-colors">
            <X size={24} />
          </button>
        </header>

        <div className="px-8 pb-8 space-y-6 max-h-[70vh] overflow-y-auto">
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Metas Gerais</h3>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">Meta de Economia</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500">R$</span>
                <input 
                  type="number" 
                  value={localSavingsGoal}
                  onChange={(e) => setLocalSavingsGoal(parseFloat(e.target.value) || 0)}
                  className="block w-full pl-10 pr-4 py-3 border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-slate-50/50"
                  placeholder="0,00"
                />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Metas de Receita por Categoria</h3>
            </div>
            
            <div className="flex gap-2">
              <input 
                type="text"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="Nova categoria..."
                className="flex-1 px-4 py-2 border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-slate-50/50 text-sm"
              />
              <button 
                onClick={handleAddCategory}
                className="p-2 bg-indigo-100 text-indigo-600 rounded-xl hover:bg-indigo-200 transition-colors"
              >
                <Plus size={20} />
              </button>
            </div>

            <div className="space-y-4 pt-2">
              {Object.entries(localLimits).map(([category, limit]) => (
                <div key={category} className="space-y-2 group">
                  <div className="flex justify-between items-center">
                    <label className="block text-sm font-medium text-slate-700">{category}</label>
                    <button 
                      onClick={() => handleRemoveCategory(category)}
                      className="text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all"
                      title="Excluir Categoria"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 text-sm">R$</span>
                    <input 
                      type="number" 
                      value={limit}
                      onChange={(e) => handleLimitChange(category, e.target.value)}
                      className="block w-full pl-10 pr-4 py-2 border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-slate-50/50 text-sm"
                      placeholder="0,00"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-4 flex gap-3 sticky bottom-0 bg-white pb-2">
            <button 
              onClick={onClose}
              className="flex-1 px-6 py-4 border border-slate-200 text-slate-600 font-medium rounded-2xl hover:bg-slate-50 transition-colors"
            >
              Cancelar
            </button>
            <button 
              onClick={handleSave}
              className="flex-[2] px-6 py-4 bg-indigo-600 text-white font-bold rounded-2xl hover:bg-indigo-700 shadow-lg shadow-indigo-200 active:scale-[0.98] transition-all"
            >
              Salvar Alterações
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function BillModal({ onClose, onSubmit }: any) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState(new Date().toISOString().split('T')[0]);
  const [installments, setInstallments] = useState('1');
  const [recurring, setRecurring] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      name,
      amount: parseFloat(amount),
      dueDate,
      installments: parseInt(installments),
      status: 'pending',
      category: 'Geral',
      recurring
    });
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-xl border border-slate-100 w-full max-w-lg max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in duration-200 custom-scrollbar">
        <header className="px-8 pt-8 pb-4 flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-800">Nova Conta</h1>
            <p className="text-sm text-slate-500 mt-1">Cadastre uma conta para não esquecer o vencimento.</p>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 transition-colors">
            <X size={24} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="px-8 pb-8 space-y-6">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700">Nome da Conta</label>
            <input 
              type="text" 
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="block w-full px-4 py-3 border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-slate-50/50"
              placeholder="Ex: Aluguel, Internet..."
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700">Valor</label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 text-lg">R$</span>
              <input 
                type="number" 
                required
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="block w-full pl-12 pr-4 py-4 border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-xl font-medium"
                placeholder="0,00"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">Vencimento</label>
              <input 
                type="date" 
                required
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="block w-full px-4 py-3 border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-slate-50/50"
              />
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">Parcelas</label>
              <input 
                type="number" 
                required
                min="1"
                value={installments}
                onChange={(e) => setInstallments(e.target.value)}
                className="block w-full px-4 py-3 border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-slate-50/50"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 p-4 bg-indigo-50 rounded-2xl border border-indigo-100">
            <input 
              type="checkbox" 
              id="recurring"
              checked={recurring}
              onChange={(e) => setRecurring(e.target.checked)}
              className="w-5 h-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <label htmlFor="recurring" className="text-sm font-semibold text-indigo-900 cursor-pointer">
              Conta Recorrente (Repetir todo mês)
            </label>
          </div>

          <div className="pt-4 flex gap-3">
            <button 
              type="button" 
              onClick={onClose}
              className="flex-1 px-6 py-4 border border-slate-200 text-slate-600 font-medium rounded-2xl hover:bg-slate-50 transition-colors"
            >
              Cancelar
            </button>
            <button 
              type="submit"
              className="flex-[2] px-6 py-4 bg-indigo-600 text-white font-bold rounded-2xl hover:bg-indigo-700 shadow-lg shadow-indigo-200 active:scale-[0.98] transition-all"
            >
              Salvar Conta
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ConfirmationModal({ title, message, onConfirm, onCancel, type = 'danger' }: any) {
  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-xl border border-slate-100 w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="p-8">
          <div className={cn(
            "w-12 h-12 rounded-2xl flex items-center justify-center mb-6",
            type === 'danger' ? "bg-rose-100 text-rose-600" : 
            type === 'warning' ? "bg-amber-100 text-amber-600" : "bg-indigo-100 text-indigo-600"
          )}>
            <AlertCircle size={24} />
          </div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">{title}</h2>
          <p className="text-slate-500 leading-relaxed">{message}</p>
        </div>
        <div className="px-8 pb-8 flex gap-3">
          <button 
            onClick={onCancel}
            className="flex-1 px-6 py-3 border border-slate-200 text-slate-600 font-semibold rounded-xl hover:bg-slate-50 transition-colors"
          >
            Cancelar
          </button>
          <button 
            onClick={onConfirm}
            className={cn(
              "flex-1 px-6 py-3 text-white font-bold rounded-xl shadow-lg transition-all active:scale-[0.98]",
              type === 'danger' ? "bg-rose-600 hover:bg-rose-700 shadow-rose-200" : 
              type === 'warning' ? "bg-amber-600 hover:bg-amber-700 shadow-amber-200" : "bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200"
            )}
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}

function TransactionModal({ onClose, onSubmit, categories, onAddCategory, initialType = 'expense', mode = 'full', initialData }: any) {
  const [amount, setAmount] = useState(initialData?.amount?.toString() || '');
  const [type, setType] = useState<'income' | 'expense'>(
    initialData?.type || (
      mode === 'income-only' ? 'income' : 
      mode === 'expense-only' ? 'expense' : 
      initialType
    )
  );
  const [category, setCategory] = useState<string>(() => {
    if (initialData?.category) return initialData.category;
    if (mode === 'income-only' || initialType === 'income') {
      return categories.find((c: string) => c === 'Salário') || categories[0] || 'Geral';
    }
    return categories[0] || 'Geral';
  });
  const [isAddingNewCategory, setIsAddingNewCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [date, setDate] = useState(initialData?.date ? initialData.date.split('T')[0] : new Date().toISOString().split('T')[0]);
  const [description, setDescription] = useState(initialData?.description || '');

  // Update category when type changes if it's still the default
  useEffect(() => {
    if (type === 'income' && category === 'Alimentação') {
      const salaryCat = categories.find((c: string) => c === 'Salário');
      if (salaryCat) setCategory(salaryCat);
    } else if (type === 'expense' && category === 'Salário') {
      const foodCat = categories.find((c: string) => c === 'Alimentação');
      if (foodCat) setCategory(foodCat);
    }
  }, [type, categories]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    let finalCategory = category;
    if (mode === 'full' && isAddingNewCategory && newCategoryName.trim()) {
      onAddCategory(newCategoryName.trim());
      finalCategory = newCategoryName.trim();
    }

    onSubmit({
      amount: parseFloat(amount),
      category: finalCategory,
      date,
      description: description.trim() || finalCategory,
      type
    });
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-xl border border-slate-100 w-full max-w-lg max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in duration-200 custom-scrollbar">
        <header className="px-8 pt-8 pb-4 flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-800">
              {initialData ? 'Editar Transação' : (mode === 'income-only' ? 'Nova Receita' : mode === 'expense-only' ? 'Nova Despesa' : 'Nova Transação')}
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              {initialData 
                ? 'Atualize os detalhes da sua transação.'
                : (mode === 'income-only' 
                  ? 'Preencha os detalhes para registrar sua receita.' 
                  : mode === 'expense-only'
                    ? 'Preencha os detalhes para registrar sua despesa.'
                    : 'Preencha os detalhes para registrar sua despesa ou receita.')}
            </p>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 transition-colors">
            <X size={24} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="px-8 pb-8 space-y-6">
          {mode === 'full' && (
            <div className="flex p-1 bg-slate-100 rounded-xl">
              <button 
                type="button"
                onClick={() => setType('expense')}
                className={cn(
                  "flex-1 py-2 text-sm font-semibold rounded-lg transition-all",
                  type === 'expense' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                )}
              >
                Despesa
              </button>
              <button 
                type="button"
                onClick={() => setType('income')}
                className={cn(
                  "flex-1 py-2 text-sm font-semibold rounded-lg transition-all",
                  type === 'income' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                )}
              >
                Receita
              </button>
            </div>
          )}

          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700">Valor</label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 text-lg">R$</span>
              <input 
                type="number" 
                required
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="block w-full pl-12 pr-4 py-4 border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-xl font-medium"
                placeholder="0,00"
              />
            </div>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-700">Categoria</label>
                <select 
                  value={isAddingNewCategory ? "new" : category}
                  onChange={(e) => {
                    if (e.target.value === "new") {
                      setIsAddingNewCategory(true);
                    } else {
                      setIsAddingNewCategory(false);
                      setCategory(e.target.value);
                    }
                  }}
                  className="block w-full px-4 py-3 border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-slate-50/50"
                >
                  {categories.map((c: string) => <option key={c} value={c}>{c}</option>)}
                  <option value="new">+ Nova Categoria</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-700">Data</label>
                <input 
                  type="date" 
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="block w-full px-4 py-3 border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-slate-50/50"
                />
              </div>
            </div>

            {isAddingNewCategory && (
              <div className="space-y-4 animate-in slide-in-from-top-2 duration-200">
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-slate-700">Nome da Nova Categoria</label>
                  <input 
                    type="text" 
                    required
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    className="block w-full px-4 py-3 border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-slate-50/50"
                    placeholder="Ex: Presentes, Saúde..."
                    autoFocus
                  />
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700">Descrição <span className="text-slate-400 font-normal">(Opcional)</span></label>
            <textarea 
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="block w-full px-4 py-3 border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-slate-50/50 resize-none"
              placeholder={mode === 'income-only' ? "Ex: Salário Mensal" : "Adicione uma nota"}
              rows={3}
            ></textarea>
          </div>

          <div className="pt-4 flex gap-3">
            <button 
              type="button" 
              onClick={onClose}
              className="flex-1 px-6 py-4 border border-slate-200 text-slate-600 font-medium rounded-2xl hover:bg-slate-50 transition-colors"
            >
              Cancelar
            </button>
            <button 
              type="submit"
              className="flex-[2] px-6 py-4 bg-indigo-600 text-white font-bold rounded-2xl hover:bg-indigo-700 shadow-lg shadow-indigo-200 active:scale-[0.98] transition-all"
            >
              {initialData ? 'Atualizar' : 'Salvar'} {mode === 'income-only' ? 'Receita' : mode === 'expense-only' ? 'Despesa' : 'Transação'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
