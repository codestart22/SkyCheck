import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

type AlertGroup = 'TODAY' | 'YESTERDAY' | 'EARLIER THIS WEEK';

function getAlertGroup(date: Date): AlertGroup {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  if (diffDays < 1) return 'TODAY';
  if (diffDays < 2) return 'YESTERDAY';
  return 'EARLIER THIS WEEK';
}

// GET /alerts
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const alerts = await prisma.alert.findMany({
      where: { userId: req.userId },
      include: { route: { select: { label: true, startAddress: true, destAddress: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    // Group alerts
    const groups: Record<AlertGroup, typeof alerts> = {
      'TODAY': [],
      'YESTERDAY': [],
      'EARLIER THIS WEEK': [],
    };

    for (const alert of alerts) {
      const group = getAlertGroup(alert.createdAt);
      groups[group].push(alert);
    }

    const result = (['TODAY', 'YESTERDAY', 'EARLIER THIS WEEK'] as AlertGroup[]).map(label => ({
      label,
      alerts: groups[label].map(a => ({
        id:         a.id,
        type:       a.type,
        riskLevel:  a.riskLevel,
        title:      a.title,
        body:       a.body,
        routeId:    a.routeId,
        routeLabel: a.route?.label ??
          (a.route ? `${a.route.startAddress.split(',')[0]} → ${a.route.destAddress.split(',')[0]}` : undefined),
        isRead:     a.isRead,
        createdAt:  a.createdAt.toISOString(),
      })),
    }));

    res.json(result);
  } catch (err) {
    console.error('[Alerts] Fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch alerts.' });
  }
});

// PATCH /alerts/:id/read
router.patch('/:id/read', requireAuth, async (req: Request, res: Response) => {
  try {
const alert = await prisma.alert.findUnique({ where: { id: String(req.params.id) } });
    if (!alert) { res.status(404).json({ error: 'Alert not found.' }); return; }
    if (alert.userId !== req.userId) { res.status(403).json({ error: 'Forbidden.' }); return; }

    await prisma.alert.update({ where: { id: String(req.params.id) }, data: { isRead: true } });
    res.json({ message: 'Alert marked as read.' });
  } catch {
    res.status(500).json({ error: 'Failed to update alert.' });
  }
});

// PATCH /alerts/read-all
router.patch('/read-all', requireAuth, async (req: Request, res: Response) => {
  try {
    await prisma.alert.updateMany({
      where: { userId: req.userId, isRead: false },
      data:  { isRead: true },
    });
    res.json({ message: 'All alerts marked as read.' });
  } catch {
    res.status(500).json({ error: 'Failed to update alerts.' });
  }
});

export default router;
