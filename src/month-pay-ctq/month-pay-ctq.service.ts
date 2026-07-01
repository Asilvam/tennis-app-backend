import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { MonthPayCtq, MonthPayCtqDocument } from './entities/monthpayctq.entity';
import { CreatePayMonthMpDto } from './dto/create-pay-month-mp.dto';
import { RegisterService } from '../register/register.service';
import { EmailService } from '../email/email.service';

@Injectable()
export class MonthPayCtqService {
  private readonly logger = new Logger(MonthPayCtqService.name);

  constructor(
    @InjectModel(MonthPayCtq.name)
    private readonly monthPayCtqModel: Model<MonthPayCtqDocument>,
    private readonly registerService: RegisterService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
  ) {}

  async findByPaymentId(idPayment: string): Promise<MonthPayCtqDocument | null> {
    return this.monthPayCtqModel.findOne({ idPayment }).exec();
  }

  async initiatePayment(dto: CreatePayMonthMpDto) {
    const payer = await this.registerService.findOneByEmail(dto.email);
    if (!payer) {
      this.logger.warn(`Payer with email ${dto.email} not found`);
      throw new NotFoundException(`Socio pagador con email ${dto.email} no encontrado`);
    }

    // Generate unique, compact 15-character payment ID
    const idPayment = uuidv4().replace(/-/g, '').substring(0, 15);

    // Persist pending payment record in MongoDB (monthpayctq)
    const newPayment = new this.monthPayCtqModel({
      idPayment,
      namePlayer: payer.namePlayer,
      email: dto.email,
      paymentType: dto.paymentType,
      amount: dto.amount,
      monthToPay: dto.monthToPay,
      emailCarga: dto.emailCarga || undefined,
      status: 'pending',
    });
    await newPayment.save();

    // Call Mercado Pago microservice using the dedicated monthly payment DTO
    const mpApiUrl = this.configService.get<string>('MP_API_URL');
    const mpPayload = {
      email: dto.email,
      paymentType: dto.paymentType,
      amount: dto.amount,
      monthToPay: dto.monthToPay,
      idPayment,
      emailCarga: dto.emailCarga || undefined,
    };

    try {
      this.logger.log(`Requesting MP monthly preference for ID: ${idPayment}`);
      const response = await axios.post(`${mpApiUrl}/create-preference-monthly`, mpPayload);
      this.logger.log(`MP monthly preference created successfully for ID: ${idPayment}`);
      return response.data; // Returns { preferenceId, initPoint }
    } catch (error) {
      this.logger.error(`Error calling MP microservice for preference: ${error.message}`);
      throw error;
    }
  }

  async approvePayment(idPayment: string) {
    const payment = await this.monthPayCtqModel.findOne({ idPayment }).exec();
    if (!payment) {
      this.logger.warn(`Monthly payment with idPayment ${idPayment} not found in monthpayctq`);
      return null;
    }

    if (payment.status === 'approved') {
      this.logger.log(`Monthly payment ${idPayment} is already approved.`);
      return payment;
    }

    payment.status = 'approved';
    const updatedPayment = await payment.save();
    this.logger.log(`Monthly payment ${idPayment} updated to approved in monthpayctq.`);

    // Enable the correct player (emailCarga if 'Familiar', otherwise payer email)
    const emailToEnable = payment.paymentType === 'Familiar' && payment.emailCarga
      ? payment.emailCarga
      : payment.email;

    this.logger.log(`Enabling player payment status for email: ${emailToEnable}`);
    await this.registerService.enablePlayerPayment(emailToEnable);

    return updatedPayment;
  }

  async getPaymentHistory(email: string) {
    return this.monthPayCtqModel.find({ email }).sort({ createdAt: -1 }).exec();
  }

  async sendMonthlyPaymentEmail(idPayment: string, paymentStatus: string) {
    const monthlyPayment = await this.monthPayCtqModel.findOne({ idPayment }).exec();
    if (!monthlyPayment) {
      this.logger.warn(`[sendMonthlyPaymentEmail] Payment with idPayment ${idPayment} not found`);
      return;
    }

    const payer = await this.registerService.findOneByEmail(monthlyPayment.email);
    const payerName = payer ? payer.namePlayer : monthlyPayment.namePlayer;

    if (paymentStatus === 'approved') {
      let beneficiaryName = payerName;
      let habilitacionMsg = 'Tu cuenta ha sido habilitada exitosamente para realizar reservas de canchas en el Club.';

      if (monthlyPayment.paymentType === 'Familiar' && monthlyPayment.emailCarga) {
        const beneficiary = await this.registerService.findOneByEmail(monthlyPayment.emailCarga);
        beneficiaryName = beneficiary ? beneficiary.namePlayer : monthlyPayment.emailCarga;
        habilitacionMsg = `La cuenta de tu carga familiar <strong>${beneficiaryName} (${monthlyPayment.emailCarga})</strong> ha sido habilitada exitosamente para realizar reservas de canchas en el Club.`;
      }

      const buildEmailData = {
        to: monthlyPayment.email,
        subject: `✅ Pago Confirmado - Mensualidad Aprobada (${monthlyPayment.monthToPay})`,
        html: `
<div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: auto; border: 1px solid #e0e0e0; border-radius: 8px; padding: 20px;">
  <h2 style="color: #2e7d32; text-align: center; margin: 0 0 20px 0; border-bottom: 2px solid #4caf50; padding-bottom: 12px;">
    ✅ Pago de Mensualidad Confirmado
  </h2>
  
  <p style="font-size: 15px; margin: 0 0 15px 0;">Estimado(a) ${payerName},</p>
  
  <div style="background: #e8f5e9; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
    <p style="margin: 0; font-size: 15px; color: #1b5e20;">
      <strong>✓ Tu pago fue confirmado con éxito.</strong>
    </p>
  </div>

  <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 14px;">
    <tr style="border-bottom: 1px solid #eee;">
      <td style="padding: 8px 0; color: #666; font-weight: bold;">Tipo de Membresía:</td>
      <td style="padding: 8px 0; text-align: right;">${monthlyPayment.paymentType}</td>
    </tr>
    <tr style="border-bottom: 1px solid #eee;">
      <td style="padding: 8px 0; color: #666; font-weight: bold;">Mes de Cobertura:</td>
      <td style="padding: 8px 0; text-align: right;">${monthlyPayment.monthToPay}</td>
    </tr>
    <tr style="border-bottom: 1px solid #eee;">
      <td style="padding: 8px 0; color: #666; font-weight: bold;">Monto Pagado:</td>
      <td style="padding: 8px 0; text-align: right; font-weight: bold;">$${monthlyPayment.amount.toLocaleString('es-CL')} CLP</td>
    </tr>
    <tr style="border-bottom: 1px solid #eee;">
      <td style="padding: 8px 0; color: #666; font-weight: bold;">Referencia de Pago:</td>
      <td style="padding: 8px 0; text-align: right; font-family: monospace;">${monthlyPayment.idPayment}</td>
    </tr>
  </table>

  <p style="font-size: 14px; line-height: 1.5; background-color: #f9f9f9; padding: 12px; border-radius: 4px; border-left: 4px solid #1e88e5; color: #1e88e5;">
    ${habilitacionMsg}
  </p>

  <p style="margin-top: 25px; font-size: 15px;">¡Gracias por estar al día y nos vemos en las canchas!</p>
  <p style="margin: 5px 0 0 0; font-size: 15px;"><strong>Club de Tenis Quintero</strong></p>
</div>
        `,
      };
      await this.emailService.sendEmail(buildEmailData);
    } else {
      let beneficiaryName = payerName;
      if (monthlyPayment.paymentType === 'Familiar' && monthlyPayment.emailCarga) {
        const beneficiary = await this.registerService.findOneByEmail(monthlyPayment.emailCarga);
        beneficiaryName = beneficiary ? beneficiary.namePlayer : monthlyPayment.emailCarga;
      }

      const buildEmailData = {
        to: monthlyPayment.email,
        subject: `❌ Pago Rechazado - Mensualidad No Procesada (${monthlyPayment.monthToPay})`,
        html: `
<div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: auto; border: 1px solid #e0e0e0; border-radius: 8px; padding: 20px;">
  <h2 style="color: #c62828; text-align: center; margin: 0 0 20px 0; border-bottom: 2px solid #d32f2f; padding-bottom: 12px;">
    ❌ Pago de Mensualidad Rechazado
  </h2>
  
  <p style="font-size: 15px; margin: 0 0 15px 0;">Estimado(a) ${payerName},</p>
  
  <div style="background: #ffebee; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
    <p style="margin: 0; font-size: 15px; color: #c62828;">
      <strong>✗ Tu intento de pago no fue aprobado.</strong>
    </p>
  </div>

  <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 14px;">
    <tr style="border-bottom: 1px solid #eee;">
      <td style="padding: 8px 0; color: #666; font-weight: bold;">Tipo de Membresía:</td>
      <td style="padding: 8px 0; text-align: right;">${monthlyPayment.paymentType}</td>
    </tr>
    <tr style="border-bottom: 1px solid #eee;">
      <td style="padding: 8px 0; color: #666; font-weight: bold;">Mes de Cobertura:</td>
      <td style="padding: 8px 0; text-align: right;">${monthlyPayment.monthToPay}</td>
    </tr>
    <tr style="border-bottom: 1px solid #eee;">
      <td style="padding: 8px 0; color: #666; font-weight: bold;">Monto Intentado:</td>
      <td style="padding: 8px 0; text-align: right; font-weight: bold;">$${monthlyPayment.amount.toLocaleString('es-CL')} CLP</td>
    </tr>
    <tr style="border-bottom: 1px solid #eee;">
      <td style="padding: 8px 0; color: #666; font-weight: bold;">Referencia de Pago:</td>
      <td style="padding: 8px 0; text-align: right; font-family: monospace;">${monthlyPayment.idPayment}</td>
    </tr>
  </table>

  <div style="background: #fff3e0; padding: 15px; border-radius: 5px; border-left: 4px solid #ff9800; font-size: 14px; line-height: 1.5; color: #e65100; margin-bottom: 20px;">
    💡 <strong>¿Qué sucedió?</strong> Tu transacción no pudo ser aprobada por Mercado Pago. Como resultado, la habilitación de la cuenta de <strong>${beneficiaryName}</strong> no pudo ser completada. Puedes intentar el pago nuevamente desde el portal.
  </div>

  <p style="margin-top: 25px; font-size: 15px;">Si tienes alguna duda, ponte en contacto con la administración del club.</p>
  <p style="margin: 5px 0 0 0; font-size: 15px;"><strong>Club de Tenis Quintero</strong></p>
</div>
        `,
      };
      await this.emailService.sendEmail(buildEmailData);
    }
  }
}
