// src/components/social/SocialStep.jsx
import React, { useState, useEffect, useRef } from 'react';
import { Send, Loader } from 'lucide-react';
import ErrorAlert from '../ui/ErrorAlert';
import MessageCard from '../social/MessageCard';

// Messages de démo (mode test)
const DEMO_MESSAGES = [
  {
    id: 'demo-1',
    author: 'demo_bc1q...abc3',
    content: 'Saviez-vous que la cryptographie asymétrique utilisée dans Bitcoin a été inventée dans les années 1970 par Whitfield Diffie et Martin Hellman ? Cette technologie est au cœur de toutes les crypto-monnaies modernes.',
    timestamp: '2025-11-08T14:32:00Z',
    isDemo: true,
    likes_count: 12,
    dislikes_count: 1,
    comments_count: 3,
    reposts_count: 2
  },
  {
    id: 'demo-2',
    author: 'demo_bc1q...def6',
    content: 'Le Mont Everest mesure 8 849 mètres, mais il continue de croître d\'environ 4 millimètres par an en raison du mouvement tectonique. La géographie n\'est jamais figée !',
    timestamp: '2025-11-08T13:15:00Z',
    isDemo: true,
    likes_count: 8,
    dislikes_count: 0,
    comments_count: 1,
    reposts_count: 1
  },
  {
    id: 'demo-3',
    author: 'demo_bc1q...ghi9',
    content: 'Le philosophe Épictète disait : "Ce ne sont pas les événements qui troublent les hommes, mais l\'opinion qu\'ils en ont." Le stoïcisme reste d\'une actualité surprenante.',
    timestamp: '2025-11-08T11:47:00Z',
    isDemo: true,
    likes_count: 15,
    dislikes_count: 2,
    comments_count: 5,
    reposts_count: 4
  },
  {
    id: 'demo-4',
    author: 'demo_bc1q...jkl2',
    content: 'Mozart a composé sa première symphonie à l\'âge de 8 ans. La créativité musicale peut s\'exprimer à tout âge, mais ce prodige reste exceptionnel dans l\'histoire de la musique.',
    timestamp: '2025-11-08T10:22:00Z',
    isDemo: true,
    likes_count: 20,
    dislikes_count: 0,
    comments_count: 2,
    reposts_count: 3
  },
  {
    id: 'demo-5',
    author: 'demo_bc1q...mno5',
    content: 'Record du monde : Usain Bolt a couru le 100m en 9,58 secondes en 2009. Ce record tient depuis plus de 15 ans et reste l\'un des plus impressionnants de l\'athlétisme.',
    timestamp: '2025-11-08T09:05:00Z',
    isDemo: true,
    likes_count: 18,
    dislikes_count: 1,
    comments_count: 4,
    reposts_count: 2
  }
];

const SocialStep = ({ 
  isTestMode,
  address,
  wbtcAvailable,
  onPublishMessage,
  onLoadMessages,
  onSocialAction,
  onBack,
  loading,
  error
}) => {
  const [messageContent, setMessageContent] = useState('');
  const [messages, setMessages] = useState([]);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const messageListRef = useRef(null);

  // Mode test : messages locaux
  const [testMessages, setTestMessages] = useState(() => {
    if (!isTestMode) return [];
    const saved = localStorage.getItem('test_messages');
    return saved ? JSON.parse(saved) : [];
  });

  // Charger messages au démarrage
  const hasLoadedRef = useRef(false);
  
  useEffect(() => {
    // Éviter double chargement en React Strict Mode
    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;
    
    if (isTestMode) {
      const allMessages = [...testMessages, ...DEMO_MESSAGES];
      setMessages(allMessages);
    } else {
      loadInitialMessages();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTestMode]);

  // Charger messages initiaux (mode authentifié)
  const loadInitialMessages = async () => {
    if (isTestMode) return;
    
    const loadedMessages = await onLoadMessages(20, 0);
    console.log('🔍 Messages chargés:', loadedMessages.map(m => ({ 
      id: m.id.slice(0, 8), 
      deleted: m.deleted_at 
    })));
    
    // Filtrer les messages supprimés côté client (temporaire)
    const activeMessages = loadedMessages.filter(m => !m.deleted_at);
    
    setMessages(activeMessages);
    setHasMore(loadedMessages.length === 20);
  };

  // Pagination
  const loadMoreMessages = async () => {
    if (isTestMode || isLoadingMore || !hasMore) return;
    
    setIsLoadingMore(true);
    const newMessages = await onLoadMessages(20, messages.length);
    setIsLoadingMore(false);
    
    // Filtrer les messages supprimés
    const activeMessages = newMessages.filter(m => !m.deleted_at);
    
    if (activeMessages.length > 0) {
      setMessages([...messages, ...activeMessages]);
      setHasMore(newMessages.length === 20);
    } else {
      setHasMore(false);
    }
  };

  // Détection scroll
  useEffect(() => {
    const handleScroll = () => {
      if (!messageListRef.current || isTestMode) return;
      
      const { scrollTop, scrollHeight, clientHeight } = messageListRef.current;
      const scrolledToBottom = scrollHeight - scrollTop - clientHeight < 300;
      
      if (scrolledToBottom && hasMore && !isLoadingMore) {
        loadMoreMessages();
      }
    };

    const listElement = messageListRef.current;
    if (listElement) {
      listElement.addEventListener('scroll', handleScroll);
      return () => listElement.removeEventListener('scroll', handleScroll);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, hasMore, isLoadingMore, isTestMode]);

  // Calculer coût message
  const calculateCost = (content) => {
    const charCount = content.replace(/\n/g, '').length;
    return charCount * 0.00000001;
  };

  const charCount = messageContent.replace(/\n/g, '').length;
  const cost = calculateCost(messageContent);

  // Publier message
  const handlePublish = async () => {
    if (!messageContent.trim()) return;
    
    if (isTestMode) {
      const newMessage = {
        id: `test-${Date.now()}`,
        author: 'demo_test...user',
        content: messageContent.trim(),
        timestamp: new Date().toISOString(),
        isTest: true,
        likes_count: 0,
        dislikes_count: 0,
        comments_count: 0,
        reposts_count: 0
      };
      
      const updatedTestMessages = [newMessage, ...testMessages];
      setTestMessages(updatedTestMessages);
      localStorage.setItem('test_messages', JSON.stringify(updatedTestMessages));
      setMessages([newMessage, ...messages]);
      setMessageContent('');
    } else {
      const success = await onPublishMessage(messageContent.trim());
      
      if (success) {
        setMessageContent('');
        await loadInitialMessages();
      }
    }
  };

  // ============ ACTIONS SOCIALES ============

  // Like message
  const handleLike = async (messageId) => {
    if (isTestMode || actionLoading) return;
    
    setActionLoading(true);
    try {
      const message = messages.find(m => m.id === messageId);
      const action = message?.user_has_liked ? 'remove_like' : 'like';

      // ✅ Appel simple - le hook gère le solde automatiquement
      await onSocialAction(action, messageId);

      // Mise à jour locale optimiste de l'UI
      setMessages(prevMessages => prevMessages.map(msg => {
        if (msg.id !== messageId) return msg;
        
        if (action === 'like') {
          return {
            ...msg,
            likes_count: msg.likes_count + 1,
            dislikes_count: msg.user_has_disliked ? msg.dislikes_count - 1 : msg.dislikes_count,
            user_has_liked: true,
            user_has_disliked: false
          };
        } else {
          return {
            ...msg,
            likes_count: msg.likes_count - 1,
            user_has_liked: false
          };
        }
      }));

    } catch (err) {
      console.error('Erreur like:', err);
      alert(`Erreur: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  // Dislike message
  const handleDislike = async (messageId) => {
    if (isTestMode || actionLoading) return;
    
    setActionLoading(true);
    try {
      const message = messages.find(m => m.id === messageId);
      const action = message?.user_has_disliked ? 'remove_dislike' : 'dislike';

      // ✅ Appel simple - le hook gère le solde automatiquement
      await onSocialAction(action, messageId);

      // Mise à jour locale optimiste de l'UI
      setMessages(prevMessages => prevMessages.map(msg => {
        if (msg.id !== messageId) return msg;
        
        if (action === 'dislike') {
          return {
            ...msg,
            dislikes_count: msg.dislikes_count + 1,
            likes_count: msg.user_has_liked ? msg.likes_count - 1 : msg.likes_count,
            user_has_disliked: true,
            user_has_liked: false
          };
        } else {
          return {
            ...msg,
            dislikes_count: msg.dislikes_count - 1,
            user_has_disliked: false
          };
        }
      }));

    } catch (err) {
      console.error('Erreur dislike:', err);
      alert(`Erreur: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  // Supprimer message
  const handleDelete = async (messageId) => {
    if (!window.confirm('Supprimer ce message ?')) return;
    
    if (isTestMode) {
      const updatedTestMessages = testMessages.filter(m => m.id !== messageId);
      setTestMessages(updatedTestMessages);
      localStorage.setItem('test_messages', JSON.stringify(updatedTestMessages));
      setMessages(messages.filter(m => m.id !== messageId));
    } else {
      setActionLoading(true);
      try {
        const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
        const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY;
        
        const response = await fetch(`${supabaseUrl}/functions/v1/social-delete`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseKey}`,
            'apikey': supabaseKey
          },
          body: JSON.stringify({ messageId, bitcoinAddress: address })
        });

        const data = await response.json();

        if (!response.ok) {
          console.error('Erreur HTTP:', response.status, data);
          throw new Error(data.error || 'Erreur suppression');
        }

        if (!data.success) {
          throw new Error(data.error || 'Échec suppression');
        }

        console.log('✅ Message supprimé');
        await loadInitialMessages();
        
      } catch (err) {
        console.error('❌ Erreur suppression:', err);
        alert('Erreur: ' + err.message);
      } finally {
        setActionLoading(false);
      }
    }
  };

  // Commenter (placeholder)
  const handleComment = (messageId) => {
    alert('Fonction commentaire en développement');
  };

  // Repost (placeholder)
  const handleRepost = (messageId) => {
    alert('Fonction repost en développement');
  };

  // Voir profil utilisateur (placeholder)
  const handleUserClick = (bitcoinAddress) => {
    alert(`Profil de ${bitcoinAddress} - en développement`);
  };

  return (
    <div className="max-w-2xl mx-auto">
      {/* Bouton retour */}
      {!isTestMode && onBack && (
        <button
          onClick={onBack}
          className="mb-4 text-gray-600 hover:text-gray-800 transition flex items-center gap-2"
        >
          <span>←</span> Retour au dashboard
        </button>
      )}
      
      {/* Header */}
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold mb-2">📝 Réseau Social Bitcoin</h2>
        <p className="text-gray-600">1 satoshi par caractère</p>
      </div>

      {/* Solde */}
      <div className="bg-orange-50 p-4 rounded-lg mb-4">
        <div className="flex justify-between items-center">
          <p className="text-orange-800 font-semibold">
            💎 Solde : {wbtcAvailable.toFixed(8)} wBTC
          </p>
          <p className="text-orange-600">
            ✍️ {Math.floor(wbtcAvailable / 0.00000001).toLocaleString()} caractères restants
          </p>
        </div>
      </div>

      {isTestMode && (
        <div className="bg-yellow-50 border border-yellow-200 p-3 rounded-lg mb-4 text-sm text-yellow-800">
          ⚠️ Mode démo : actions sociales désactivées, messages locaux uniquement
        </div>
      )}

      <ErrorAlert error={error} />

      {/* Formulaire publication */}
      <div className="bg-white border-2 border-gray-200 rounded-lg p-4 mb-6">
        <textarea
          value={messageContent}
          onChange={(e) => setMessageContent(e.target.value)}
          placeholder="Écrivez votre message..."
          maxLength={1000}
          rows={4}
          className="w-full p-3 border border-gray-300 rounded-lg resize-none focus:outline-none focus:border-orange-500"
        />
        
        <div className="flex justify-between items-center mt-3">
          <div className="text-sm text-gray-600">
            <span className={charCount > 1000 ? 'text-red-600 font-semibold' : ''}>
              {charCount} / 1000 caractères
            </span>
            <span className="ml-4">
              💰 Coût : {cost.toFixed(8)} wBTC
            </span>
          </div>
          
          <button
            onClick={handlePublish}
            disabled={loading || !messageContent.trim() || charCount > 1000}
            className="bg-orange-500 text-white px-6 py-2 rounded-lg font-semibold hover:bg-orange-600 transition flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader className="w-4 h-4 animate-spin" />
                Publication...
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                Publier
              </>
            )}
          </button>
        </div>
      </div>

      {/* Fil de messages */}
      <div 
        ref={messageListRef}
        className="bg-white border-2 border-gray-200 rounded-lg p-4 max-h-[600px] overflow-y-auto"
      >
        <h3 className="text-lg font-bold mb-4 text-gray-700">Messages récents</h3>
        
        {messages.length === 0 ? (
          <p className="text-gray-500 text-center py-8">Aucun message pour le moment</p>
        ) : (
          <div className="space-y-4">
            {messages.map((msg) => (
              <MessageCard
                key={msg.id}
                message={msg}
                currentAddress={address}
                isTestMode={isTestMode}
                onLike={handleLike}
                onDislike={handleDislike}
                onComment={handleComment}
                onRepost={handleRepost}
                onDelete={handleDelete}
                onUserClick={handleUserClick}
              />
            ))}
            
            {!isTestMode && isLoadingMore && (
              <div className="text-center py-2">
                <Loader className="w-5 h-5 animate-spin inline-block text-gray-400" />
              </div>
            )}
            
            {!isTestMode && !hasMore && messages.length > 0 && (
              <p className="text-center text-gray-400 text-sm py-2">Fin des messages</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default SocialStep;