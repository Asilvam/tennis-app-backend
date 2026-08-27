import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PaymentCallbackEffect, PaymentCallbackEffectDocument, PaymentCallbackEffectStatus } from './entities/payment-callback-effect.entity';

export interface PaymentEffectResult<T> {
  processed: boolean;
  status: PaymentCallbackEffectStatus;
  value?: T;
}

@Injectable()
export class PaymentCallbackEffectService {
  private readonly staleLockMs = 5 * 60 * 1000;

  constructor(
    @InjectModel(PaymentCallbackEffect.name)
    private readonly effectModel: Model<PaymentCallbackEffectDocument>,
  ) {}

  async executeOnce<T>(idempotencyKey: string, effectType: PaymentCallbackEffect['effectType'], reservationId: string, paymentStatus: string | undefined, effect: () => Promise<T>): Promise<PaymentEffectResult<T>> {
    await this.ensurePendingEffect(idempotencyKey, effectType, reservationId, paymentStatus);

    const staleBefore = new Date(Date.now() - this.staleLockMs);
    const claimed = await this.effectModel
      .findOneAndUpdate(
        {
          idempotencyKey,
          effectType,
          reservationId,
          paymentStatus,
          $or: [{ status: PaymentCallbackEffectStatus.PENDING }, { status: PaymentCallbackEffectStatus.FAILED }, { status: PaymentCallbackEffectStatus.PROCESSING, lockedAt: { $lte: staleBefore } }],
        },
        {
          $set: {
            status: PaymentCallbackEffectStatus.PROCESSING,
            lockedAt: new Date(),
            lastError: null,
          },
          $inc: { attempts: 1 },
        },
        { new: true },
      )
      .exec();

    if (!claimed) {
      const existing = await this.effectModel.findOne({ idempotencyKey }).select('status effectType reservationId paymentStatus').lean().exec();
      if (existing && (existing.effectType !== effectType || existing.reservationId !== reservationId || existing.paymentStatus !== paymentStatus)) {
        throw new ConflictException('Idempotency-Key was already used for a different payment effect');
      }
      return { processed: false, status: existing?.status ?? PaymentCallbackEffectStatus.PROCESSING };
    }

    try {
      const value = await effect();
      await this.effectModel
        .updateOne(
          { _id: claimed._id, status: PaymentCallbackEffectStatus.PROCESSING },
          {
            $set: {
              status: PaymentCallbackEffectStatus.PROCESSED,
              processedAt: new Date(),
            },
            $unset: { lockedAt: 1, lastError: 1 },
          },
        )
        .exec();
      return { processed: true, status: PaymentCallbackEffectStatus.PROCESSED, value };
    } catch (error) {
      await this.effectModel
        .updateOne(
          { _id: claimed._id },
          {
            $set: {
              status: PaymentCallbackEffectStatus.FAILED,
              lastError: this.errorMessage(error).slice(0, 1000),
            },
            $unset: { lockedAt: 1 },
          },
        )
        .exec();
      throw error;
    }
  }

  private async ensurePendingEffect(idempotencyKey: string, effectType: PaymentCallbackEffect['effectType'], reservationId: string, paymentStatus?: string): Promise<void> {
    try {
      await this.effectModel.create({
        idempotencyKey,
        effectType,
        reservationId,
        paymentStatus,
        status: PaymentCallbackEffectStatus.PENDING,
      });
    } catch (error) {
      if (!this.isDuplicateKey(error)) {
        throw error;
      }
    }
  }

  private isDuplicateKey(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: number }).code === 11000;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
