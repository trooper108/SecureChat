import mongoose, { Schema, Document } from 'mongoose';

export interface IMessage extends Document {
  from: string;
  to: string;
  ciphertext: string;
  iv: string;
  createdAt: Date;
  deliveredAt: Date | null;
}

const MessageSchema = new Schema<IMessage>(
  {
    from: {
      type: String,
      required: true,
      index: true
    },
    to: {
      type: String,
      required: true,
      index: true
    },
    ciphertext: {
      type: String,
      required: true
    },
    iv: {
      type: String,
      required: true
    },
    createdAt: {
      type: Date,
      default: Date.now,
      index: true
    },
    deliveredAt: {
      type: Date,
      default: null,
      index: true
    }
  },
  {
    timestamps: false // using explicit createdAt and deliveredAt
  }
);

// Compound index for offline delivery lookup
MessageSchema.index({ to: 1, deliveredAt: 1, createdAt: 1 });

// Compound index for peer history pagination
MessageSchema.index({ from: 1, to: 1, createdAt: -1 });

export const MessageModel = mongoose.model<IMessage>('Message', MessageSchema);
