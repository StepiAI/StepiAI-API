import { Injectable, OnModuleInit } from '@nestjs/common';
import * as admin from 'firebase-admin/app';
import * as messaging from 'firebase-admin/messaging';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class FirebaseService implements OnModuleInit {
  private messagingInstance!: messaging.Messaging;

  async onModuleInit() {
    try {
      const apps = admin.getApps();

      if (apps.length === 0) {
        const serviceAccount = JSON.parse(
          fs.readFileSync(
            path.join(
              process.cwd(),
              'stepiai-firebase-adminsdk-fbsvc-0c66c4bb04.json',
            ),
            'utf8',
          ),
        );

        admin.initializeApp({ credential: admin.cert(serviceAccount) });
      }

      this.messagingInstance = messaging.getMessaging(admin.getApp());
      console.log('Firebase initialized successfully');
    } catch (error) {
      console.error('Error initializing Firebase:', error);
      throw error;
    }
  }

  async sendNotification(
    deviceToken: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ) {
    try {
      const message = {
        notification: {
          title,
          body,
        },
        data: data || {},
        token: deviceToken,
      };

      const response = await this.messagingInstance.send(message);
      console.log('Notification sent successfully:', response);
      return { success: true, messageId: response };
    } catch (error) {
      console.error('Error sending notification:', error);
      throw error;
    }
  }

  async sendMulticastNotification(
    deviceTokens: string[],
    title: string,
    body: string,
    data?: Record<string, string>,
  ) {
    if (deviceTokens.length === 0) {
      throw new Error('No device tokens provided');
    }

    const message: messaging.MulticastMessage = {
      tokens: deviceTokens,
      notification: {
        title,
        body,
      },
      data: data ?? {},
    };

    console.log(message);

    const response = await this.messagingInstance.sendEachForMulticast(message);

    console.log('Multicast notification sent:', response);

    return {
      success: response.successCount > 0,
      successCount: response.successCount,
      failureCount: response.failureCount,
      responses: response.responses,
    };
  }

  async sendTopicNotification(
    topic: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ) {
    try {
      const message = {
        notification: {
          title,
          body,
        },
        data: data || {},
        topic,
      };

      const response = await this.messagingInstance.send(message);
      console.log('Topic notification sent:', response);
      return { success: true, messageId: response };
    } catch (error) {
      console.error('Error sending topic notification:', error);
      throw error;
    }
  }

  async subscribeToTopic(deviceTokens: string[], topic: string) {
    try {
      const response = await this.messagingInstance.subscribeToTopic(
        deviceTokens,
        topic,
      );
      console.log(`Subscribed to topic ${topic}:`, response);
      return response;
    } catch (error) {
      console.error('Error subscribing to topic:', error);
      throw error;
    }
  }

  async unsubscribeFromTopic(deviceTokens: string[], topic: string) {
    try {
      const response = await this.messagingInstance.unsubscribeFromTopic(
        deviceTokens,
        topic,
      );
      console.log(`Unsubscribed from topic ${topic}:`, response);
      return response;
    } catch (error) {
      console.error('Error unsubscribing from topic:', error);
      throw error;
    }
  }
}
