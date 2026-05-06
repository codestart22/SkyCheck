import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { PrismaClient } from '@prisma/client';
import { signToken, requireAuth } from '../middleware/auth';
import { sendVerificationEmail, sendPasswordResetEmail } from '../services/emailService';
import { RISK } from '../constants/risk';

const router = Router();
const prisma = new PrismaClient();

// ── Rate Limiters ─────────────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Please wait 15 minutes.' },
});

const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many password reset requests. Please wait 15 minutes.' },
});

// ── POST /auth/register ───────────────────────────────────────────
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { name, email, password, confirmPassword } = req.body;

    if (!name?.trim() || !email?.trim() || !password) {
      res.status(400).json({ error: 'All fields are required.' });
      return;
    }
    if (password !== confirmPassword) {
      res.status(400).json({ error: 'Passwords do not match.' });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters.' });
      return;
    }

    const exists = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (exists) {
      // Anti-enumeration: same message whether user exists or not
      res.status(201).json({ message: 'Registration successful. Check your email to verify your account.' });
      return;
    }

    const passHash   = await bcrypt.hash(password, 12);
    const verifyTok  = crypto.randomBytes(32).toString('hex');
    const verifyExp  = new Date(Date.now() + RISK.AUTH.VERIFY_EXPIRE_H * 60 * 60 * 1000);

    const user = await prisma.user.create({
      data: { name: name.trim(), email: email.toLowerCase(), passHash, verifyTok, verifyExp },
    });

    await sendVerificationEmail(user.email, user.name, verifyTok).catch(err =>
      console.error('[Email] Failed to send verification:', err)
    );

    res.status(201).json({ message: 'Registration successful. Check your email to verify your account.' });
  } catch (err) {
    console.error('[Auth] Register error:', err);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// ── POST /auth/login ──────────────────────────────────────────────
router.post('/login', loginLimiter, async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });

    // Generic error message (anti-enumeration)
    const invalid = () => res.status(401).json({ error: 'Invalid email or password. Try again.' });

    if (!user) { invalid(); return; }

    // Check lockout
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      res.status(403).json({ error: `Account locked. Try again in ${mins} minute${mins > 1 ? 's' : ''}.` });
      return;
    }

    const valid = await bcrypt.compare(password, user.passHash);
    if (!valid) {
      const failed = user.failedLogins + 1;
      const lockUntil = failed >= RISK.AUTH.MAX_FAILED
        ? new Date(Date.now() + RISK.AUTH.LOCK_MINUTES * 60 * 1000)
        : null;
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLogins: failed, lockedUntil: lockUntil },
      });
      invalid();
      return;
    }

    if (!user.isVerified) {
      res.status(403).json({ error: 'Please verify your email address before logging in.', code: 'EMAIL_UNVERIFIED' });
      return;
    }

    // Reset failed logins on success
    await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });

    const token = signToken(user.id, user.email);
    res.json({
      accessToken: token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        isVerified: user.isVerified,
        preferences: {
          morningAlerts: user.morningAlerts,
          alertSound:    user.alertSound,
          vibration:     user.vibration,
        },
        createdAt: user.createdAt.toISOString(),
      },
    });
  } catch (err) {
    console.error('[Auth] Login error:', err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// ── POST /auth/verify-email ───────────────────────────────────────
router.post('/verify-email', async (req: Request, res: Response) => {
  try {
    const { token } = req.body;
    if (!token) { res.status(400).json({ error: 'Token is required.' }); return; }

    const user = await prisma.user.findUnique({ where: { verifyTok: token } });

    if (!user || !user.verifyExp || user.verifyExp < new Date()) {
      res.status(400).json({ error: 'Verification link is invalid or has expired.' });
      return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { isVerified: true, verifyTok: null, verifyExp: null },
    });

    const jwt = signToken(user.id, user.email);
    res.json({
      accessToken: jwt,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        isVerified: true,
        preferences: { morningAlerts: user.morningAlerts, alertSound: user.alertSound, vibration: user.vibration },
        createdAt: user.createdAt.toISOString(),
      },
    });
  } catch (err) {
    console.error('[Auth] Verify error:', err);
    res.status(500).json({ error: 'Verification failed. Please try again.' });
  }
});

// ── POST /auth/resend-verification ───────────────────────────────
router.post('/resend-verification', resetLimiter, async (req: Request, res: Response) => {
  const SAME_MSG = { message: 'If that email is registered, a new verification link has been sent.' };
  try {
    const { email } = req.body;
    if (!email) { res.json(SAME_MSG); return; }

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (user && !user.isVerified) {
      const verifyTok = crypto.randomBytes(32).toString('hex');
      const verifyExp = new Date(Date.now() + RISK.AUTH.VERIFY_EXPIRE_H * 60 * 60 * 1000);
      await prisma.user.update({ where: { id: user.id }, data: { verifyTok, verifyExp } });
      await sendVerificationEmail(user.email, user.name, verifyTok).catch(console.error);
    }
    res.json(SAME_MSG);
  } catch {
    res.json(SAME_MSG);
  }
});

// ── POST /auth/forgot-password ────────────────────────────────────
router.post('/forgot-password', resetLimiter, async (req: Request, res: Response) => {
  const SAME_MSG = { message: 'If that email is registered, a password reset link has been sent.' };
  try {
    const { email } = req.body;
    if (!email) { res.json(SAME_MSG); return; }

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (user) {
      const resetTok = crypto.randomBytes(32).toString('hex');
      const resetExp = new Date(Date.now() + RISK.AUTH.RESET_EXPIRE_H * 60 * 60 * 1000);
      await prisma.user.update({ where: { id: user.id }, data: { resetTok, resetExp } });
      await sendPasswordResetEmail(user.email, user.name, resetTok).catch(console.error);
    }
    res.json(SAME_MSG);
  } catch {
    res.json(SAME_MSG);
  }
});

// ── POST /auth/reset-password ─────────────────────────────────────
router.post('/reset-password', async (req: Request, res: Response) => {
  try {
    const { token, newPassword, confirmPassword } = req.body;
    if (!token || !newPassword) {
      res.status(400).json({ error: 'Token and new password are required.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      res.status(400).json({ error: 'Passwords do not match.' });
      return;
    }
    if (newPassword.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters.' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { resetTok: token } });
    if (!user || !user.resetExp || user.resetExp < new Date()) {
      res.status(400).json({ error: 'Reset link is invalid or has expired.' });
      return;
    }

    const passHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: { passHash, resetTok: null, resetExp: null, failedLogins: 0, lockedUntil: null },
    });

    res.json({ message: 'Password reset successfully. You can now log in with your new password.' });
  } catch (err) {
    console.error('[Auth] Reset error:', err);
    res.status(500).json({ error: 'Reset failed. Please try again.' });
  }
});

// ── POST /auth/logout ─────────────────────────────────────────────
router.post('/logout', requireAuth, async (_req: Request, res: Response) => {
  // JWT is stateless — client must delete the token
  // If needed, maintain a token blocklist here
  res.json({ message: 'Logged out successfully.' });
});

// ── GET /auth/me ──────────────────────────────────────────────────
router.get('/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) { res.status(404).json({ error: 'User not found.' }); return; }

    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      isVerified: user.isVerified,
      preferences: { morningAlerts: user.morningAlerts, alertSound: user.alertSound, vibration: user.vibration },
      createdAt: user.createdAt.toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get user.' });
  }
});

// ── PATCH /auth/preferences ───────────────────────────────────────
router.patch('/preferences', requireAuth, async (req: Request, res: Response) => {
  try {
    const { morningAlerts, alertSound, vibration } = req.body;
    const user = await prisma.user.update({
      where: { id: req.userId },
      data: {
        ...(morningAlerts !== undefined && { morningAlerts }),
        ...(alertSound    !== undefined && { alertSound }),
        ...(vibration     !== undefined && { vibration }),
      },
    });
    res.json({
      id: user.id, name: user.name, email: user.email, isVerified: user.isVerified,
      preferences: { morningAlerts: user.morningAlerts, alertSound: user.alertSound, vibration: user.vibration },
      createdAt: user.createdAt.toISOString(),
    });
  } catch {
    res.status(500).json({ error: 'Failed to update preferences.' });
  }
});

// ── POST /auth/change-password ────────────────────────────────────
router.post('/change-password', requireAuth, async (req: Request, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: 'Both passwords are required.' });
      return;
    }
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) { res.status(404).json({ error: 'User not found.' }); return; }

    const valid = await bcrypt.compare(currentPassword, user.passHash);
    if (!valid) { res.status(401).json({ error: 'Current password is incorrect.' }); return; }

    if (newPassword.length < 8) {
      res.status(400).json({ error: 'New password must be at least 8 characters.' });
      return;
    }

    const passHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: user.id }, data: { passHash } });
    res.json({ message: 'Password changed successfully.' });
  } catch {
    res.status(500).json({ error: 'Failed to change password.' });
  }
});

export default router;
