import mongoose, { Schema, Document } from 'mongoose';

export interface IUserKey extends Document {
  userId: string;
  publicKey: Record<string, any>;
  updatedAt: Date;
  createdAt: Date;
}

const UserKeySchema = new Schema<IUserKey>(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    publicKey: {
      type: Schema.Types.Mixed,
      required: true
    }
  },
  {
    timestamps: true
  }
);

export const UserKeyModel = mongoose.model<IUserKey>('UserKey', UserKeySchema);
