// src/components/social/MessageCard.jsx
import React, { useState } from 'react';
import { Heart, MessageCircle, Repeat2, Trash2, ThumbsDown } from 'lucide-react';
import { truncateAddress } from '../../supabaseClient';

const MessageCard = ({ 
  message,
  currentAddress,
  isTestMode,
  onLike,
  onDislike,
  onComment,
  onLoadComments,
  onRepost,
  onDelete,
  onUserClick,
  showActions = true
}) => {
  // ===== TOUS LES ÉTATS D'ABORD =====
  const [showComments, setShowComments] = useState(false);
  const [showCommentForm, setShowCommentForm] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [comments, setComments] = useState([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  
  // États locaux pour gestion optimiste des likes/dislikes
  const [localLikesCount, setLocalLikesCount] = useState(message.likes_count || 0);
  const [localDislikesCount, setLocalDislikesCount] = useState(message.dislikes_count || 0);
  const [localUserHasLiked, setLocalUserHasLiked] = useState(message.user_has_liked || false);
  const [localUserHasDisliked, setLocalUserHasDisliked] = useState(message.user_has_disliked || false);
  const [localCommentsCount, setLocalCommentsCount] = useState(message.comments_count || 0);
  
  // ===== HANDLERS ENSUITE =====
  // Handler like local
  const handleLocalLike = async () => {
    const action = localUserHasLiked ? 'remove_like' : 'like';
    
    // Mise à jour optimiste locale
    if (action === 'like') {
      setLocalLikesCount(localLikesCount + 1);
      setLocalDislikesCount(localUserHasDisliked ? localDislikesCount - 1 : localDislikesCount);
      setLocalUserHasLiked(true);
      setLocalUserHasDisliked(false);
    } else {
      setLocalLikesCount(localLikesCount - 1);
      setLocalUserHasLiked(false);
    }
    
    // Appel backend
    if (onLike) await onLike(message.id);
  };

  // Handler dislike local
  const handleLocalDislike = async () => {
    const action = localUserHasDisliked ? 'remove_dislike' : 'dislike';
    
    // Mise à jour optimiste locale
    if (action === 'dislike') {
      setLocalDislikesCount(localDislikesCount + 1);
      setLocalLikesCount(localUserHasLiked ? localLikesCount - 1 : localLikesCount);
      setLocalUserHasDisliked(true);
      setLocalUserHasLiked(false);
    } else {
      setLocalDislikesCount(localDislikesCount - 1);
      setLocalUserHasDisliked(false);
    }
    
    // Appel backend
    if (onDislike) await onDislike(message.id);
  };

  // Charger les commentaires d'un message
  const loadComments = async () => {
    if (loadingComments || commentsLoaded) return;
    
    setLoadingComments(true);
    try {
      // Appeler onLoadComments passé en prop
      const loadedComments = await onLoadComments(message.id);
      setComments(loadedComments);
      setCommentsLoaded(true);
    } catch (err) {
      console.error('Erreur chargement commentaires:', err);
    } finally {
      setLoadingComments(false);
    }
  };

  // ===== VARIABLES ET FONCTIONS UTILITAIRES =====
  // Vérifier si l'utilisateur actuel est l'auteur
  const isOwnMessage = message.bitcoin_address === currentAddress || 
                       (isTestMode && message.isTest);
  
  // Formater timestamp
  const formatTimestamp = (timestamp) => {
    const date = new Date(timestamp);
    const now = new Date();
    
    // Utiliser getTime() pour comparer en UTC (évite les décalages timezone)
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'À l\'instant';
    if (diffMins < 60) return `Il y a ${diffMins}min`;
    if (diffMins < 1440) return `Il y a ${Math.floor(diffMins / 60)}h`;
    
    // Afficher dans la timezone locale de l'utilisateur (pas de timeZone forcé)
    return date.toLocaleDateString('fr-FR', { 
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric'
    });
  };

  const displayAddress = message.isDemo || message.isTest 
    ? message.author 
    : truncateAddress(message.bitcoin_address);

  // ===== RENDU =====
  return (
    <div className={`border-b border-gray-100 pb-4 ${
      message.isTest ? 'bg-yellow-50 p-3 rounded-lg' : ''
    }`}>
      {/* Header */}
      <div className="flex justify-between items-start mb-2">
        <button
          onClick={() => onUserClick && onUserClick(message.bitcoin_address)}
          className={`font-semibold text-sm hover:underline ${
            message.isDemo ? 'text-blue-600' : 
            message.isTest ? 'text-yellow-600' : 
            'text-gray-800'
          }`}
        >
          {displayAddress}
        </button>
        
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">
            {formatTimestamp(message.created_at || message.timestamp)}
          </span>
          
          {/* Bouton supprimer (seulement pour ses propres messages) */}
          {isOwnMessage && showActions && onDelete && (
            <button
              onClick={() => onDelete(message.id)}
              className="text-red-500 hover:text-red-700 transition"
              title="Supprimer"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Indicateur repost */}
      {message.repost_of && (
        <div className="text-xs text-gray-500 mb-1 flex items-center gap-1">
          <Repeat2 className="w-3 h-3" />
          Repost
        </div>
      )}

      {/* Contenu */}
      <p className="text-gray-700 whitespace-pre-wrap mb-3">{message.content}</p>

      {/* Actions */}
      {showActions && (
        <div className="flex items-center gap-4 text-sm">
          {/* Like */}
          <button
            onClick={handleLocalLike}
            disabled={!onLike}
            className={`flex items-center gap-1 transition ${
              localUserHasLiked 
                ? 'text-red-500 font-semibold' 
                : 'text-gray-500 hover:text-red-500'
            } disabled:cursor-not-allowed`}
          >
            <Heart className={`w-4 h-4 ${localUserHasLiked ? 'fill-current' : ''}`} />
            <span>{localLikesCount}</span>
          </button>

          {/* Dislike */}
          <button
            onClick={handleLocalDislike}
            disabled={!onDislike}
            className={`flex items-center gap-1 transition ${
              localUserHasDisliked 
                ? 'text-blue-500 font-semibold' 
                : 'text-gray-500 hover:text-blue-500'
            } disabled:cursor-not-allowed`}
          >
            <ThumbsDown className={`w-4 h-4 ${localUserHasDisliked ? 'fill-current' : ''}`} />
            <span>{localDislikesCount}</span>
          </button>

          {/* Commentaires */}
          <button
            onClick={() => {
              setShowComments(!showComments);
              if (!showComments && !commentsLoaded) {
                loadComments();
              }
            }}
            className="flex items-center gap-1 text-gray-500 hover:text-orange-500 transition"
          >
            <MessageCircle className="w-4 h-4" />
            <span>{localCommentsCount}</span>
          </button>

          {/* Repost */}
          <button
            onClick={() => onRepost && onRepost(message.id)}
            disabled={!onRepost || isOwnMessage}
            className="flex items-center gap-1 text-gray-500 hover:text-green-500 transition disabled:cursor-not-allowed disabled:opacity-50"
            title={isOwnMessage ? "Impossible de reposter son propre message" : "Reposter"}
          >
            <Repeat2 className="w-4 h-4" />
            <span>{message.reposts_count || 0}</span>
          </button>
        </div>
      )}

      {/* Zone commentaires */}
      {showComments && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          {/* Bouton ajouter commentaire */}
          {!showCommentForm && (
            <button
              onClick={() => setShowCommentForm(true)}
              className="text-sm text-orange-600 hover:text-orange-700 font-semibold mb-3"
            >
              + Ajouter un commentaire
            </button>
          )}

          {/* Formulaire de commentaire */}
          {showCommentForm && (
            <div className="mb-4 p-3 bg-gray-50 rounded">
              <textarea
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Écrivez votre commentaire..."
                className="w-full p-2 border rounded resize-none focus:outline-none focus:ring-2 focus:ring-orange-500"
                rows={3}
              />
              <div className="flex justify-between items-center mt-2">
                <span className="text-xs text-gray-500">
                  {commentText.replace(/\n/g, '').length} caractères • Coût: {(commentText.replace(/\n/g, '').length * 0.00000001).toFixed(8)} wBTC
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setShowCommentForm(false);
                      setCommentText('');
                    }}
                    className="px-3 py-1 text-sm text-gray-600 hover:text-gray-800"
                  >
                    Annuler
                  </button>
                  <button
                    onClick={async () => {
                      if (onComment) {
                        await onComment(message.id, commentText, async (newComment) => {
                          // Incrémenter le compteur local
                          setLocalCommentsCount(localCommentsCount + 1);
                          
                          // Ajouter le nouveau commentaire localement
                          if (newComment) {
                            setComments(prevComments => [newComment, ...prevComments]);
                          }
                          
                          // Réinitialiser le formulaire
                          setCommentText('');
                          setShowCommentForm(false);
                        });
                      }
                    }}
                    disabled={commentText.trim().length === 0}
                    className="px-3 py-1 text-sm bg-orange-600 text-white rounded hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Publier
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Liste des commentaires */}
          {loadingComments ? (
            <p className="text-sm text-gray-500">Chargement des commentaires...</p>
          ) : comments.length > 0 ? (
            <div className="space-y-3 pl-4 border-l-2 border-gray-200">
              {comments.map(comment => (
                <MessageCard
                  key={comment.id}
                  message={comment}
                  currentAddress={currentAddress}
                  isTestMode={isTestMode}
                  onLike={onLike}
                  onDislike={onDislike}
                  onComment={onComment}
                  onLoadComments={onLoadComments}
                  onRepost={onRepost}
                  onDelete={onDelete}
                  onUserClick={onUserClick}
                  showActions={true}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500 italic">Aucun commentaire</p>
          )}
        </div>
      )}
    </div>
  );
};

export default MessageCard;